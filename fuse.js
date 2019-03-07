const { FuseBox, JSONPlugin, RawPlugin, QuantumPlugin } = require( "fuse-box" );
const { task, src, watch, tsc } = require( "fuse-box/sparky" );
const { exec: pkg } = require( 'pkg' );
const makeDir = require( 'make-dir' );
const path = require( 'path' );
const fs = require( 'mz/fs' );
const del = require( "del" );
const got = require('got');


const nativeFolders = [
    'node_modules/sharp/build/Release'
];

const build = async ( isProduction, watch ) => {
    const fuse = FuseBox.init( {
        homeDir : "src",
        target : 'server@es6',
        output : "dist/$name.js",
        useTypescriptCompiler : true,
        log: {
            showBundledFiles: false // Don't list all the bundled files every time we bundle
        },
        plugins: [ 
            JSONPlugin(),
            RawPlugin( [ '.txt.js', '.txt', '.txt.ts' ] ),
            isProduction && QuantumPlugin( {
                uglify: true,
                css: true,
                bakeApiIntoBundle: true,
                ensureES5: false,
                processPolyfill: true
            } )
        ]
    } );
    
    fuse.bundle( "vendor" )
        .instructions( "~ cli.ts" )
    
    const app = fuse.bundle( "app" )
        .completed( proc => proc.start() )
        .instructions( "> [cli.ts]" );

    if ( watch ) app.watch();
    
    await fuse.run();
};

task( 'build:dev', async context => build( false, true ) );

task( 'build:rel', async context => build( true, true ) );

task( 'build:copy', async context => {
    await watch( '**/*.(yaml|json)', { base: "src" } )
        .dest( "lib/" )
        .exec();
} );

let packageDependencies = {
    'win32': {
        'ffmpeg': 'https://ffmpeg.zeranoe.com/builds/win64/static/ffmpeg-4.1-win64-static.zip',
        'rethinkdb': 'https://download.rethinkdb.com/windows/rethinkdb-2.3.6.zip',
        'sharp': 'https://github.com/lovell/sharp/releases/download/v0.21.1/sharp-v0.21.1-node-v64-win32-x64.tar.gz',
        'libvips': 'https://github.com/lovell/sharp-libvips/releases/download/v8.7.0/libvips-8.7.0-win32-x64.tar.gz'
    },
    'linux': {
        'ffmpeg': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        'rethinkdb': null,
        'sharp': 'https://github.com/lovell/sharp/releases/download/v0.21.1/sharp-v0.21.1-node-v64-linux-x64.tar.gz',
        'libvips': 'https://github.com/lovell/sharp-libvips/releases/download/v8.7.0/libvips-8.7.0-linux-x64.tar.gz'
    },
    'darwin': {
        'ffmpeg': 'https://evermeet.cx/ffmpeg/ffmpeg-4.1.7z',
        'rethinkdb': 'https://download.rethinkdb.com/osx/rethinkdb-2.3.6.dmg',
        'sharp': 'https://github.com/lovell/sharp/releases/download/v0.21.1/sharp-v0.21.1-node-v64-darwin-x64.tar.gz',
        'libvips': 'https://github.com/lovell/sharp-libvips/releases/download/v8.7.0/libvips-8.7.0-darwin-x64.tar.gz'
    }
};

const extractors = {};

async function fetch ( platform, dependency, force = false ) {
    if ( dependency instanceof Array ) {
        for ( let dep of dependency ) {
            await fetch( platform, dep, force );
        }

        return;
    }
    
    const targetFolder = path.join( 'builds', '.cache', 'compressed', platform, dependency );

    if ( !force && await fs.exists( targetFolder ) ) {
        return;
    }

    const url = packageDependencies[ platform ][ dependency ];

    if ( !url ) {
        return;
    }
 
    try {
        const targetFile = path.join( targetFolder, path.basename( url ) );

        const format = path.extname( targetFile );

        await makeDir( targetFolder );

        const stream = got.stream( url ).pipe( fs.createWriteStream( targetFile ) );

        await new Promise( ( resolve, reject ) => stream.on( 'error', reject ).on( 'finish', () => resolve() ) );

        if ( format in extractors ) {
            await extractors[ format ]( platform, dependency, targetFile );

            await fs.unlink( targetFile );
        }
    } catch ( error ) {
        console.log( error.response.body );
    }
}

function getPackageHost ( platform ) {
    if ( platform == 'win32' ) {
        return 'win';
    } else {
        return platform;
    }
}

async function package ( platform ) {
    // sharp: https://github.com/lovell/sharp/releases
    // lipvips: https://github.com/lovell/sharp-libvips/releases/
    await fetch( platform, [ 'ffmpeg', 'rethinkdb', 'libvips', 'sharp' ] );

    const buildFolder = `builds/${ platform }/`;

    await reset( buildFolder );

    await tsc( __dirname, {
        ...JSON.parse( ( await fs.readFile( 'tsconfig.json', 'utf8' ) ) ).compilerOptions
    } );

    await pkg( [ '.', '--target', getPackageHost( platform ), '--out-path', buildFolder ] );

    for ( let native of nativeFolders ) {
        await makeDir( path.join( buildFolder, native ) );

        await src( path.join( native, '**/*' ), { base: "." } )
            .dest( buildFolder )
            .exec();
    }

    
    await copy( 
        './lib/Extensions',
        path.join( buildFolder, 'Extensions' )
    );

    await copy( 
        './config',
        path.join( buildFolder, 'config' ),
        [ 'default*.yaml' ]
    );

    await copy( 
        `./builds/.cache/uncompressed/${ platform }/rethinkdb`,
        path.join( buildFolder, 'storage' )
    );
    
    await copy( 
        `./builds./cache/uncompressed/${ platform }/ffmpeg`,
        path.join( buildFolder, 'storage', 'ffmpeg' )
    );

    await copy( 
        `./builds/.cache/uncompressed/${ platform }/sharp`,
        path.join( buildFolder, 'node_modules', 'sharp' )
    );

    await copy( 
        `./builds/.cache/uncompressed/${ platform }/libvips/lib`,
        path.join( buildFolder, 'node_modules', 'sharp', 'build', 'Release' )
    );
}

task( 'package:win', context => package( 'win32' ) );
task( 'package:linux', context => package( 'linux' ) );
task( 'package:darwin', context => package( 'darwin' ) );

task( 'package', [ 'package:win', 'package:linux', 'package:darwin' ] );

task( 'check', async context => {
    await tsc( __dirname, {
        ...JSON.parse( ( await fs.readFile( 'tsconfig.json', 'utf8' ) ) ).compilerOptions,
        noEmit: true,
        watch: true
    } );
} );

task( 'default', [ 'build:dev' ] );

async function reset ( folder ) {
    const stats = await fs.stat( folder ).catch( err => null );

    if ( stats ) {
        await del( folder );
    } else {
        await makeDir( folder );
    }
}

async function copy ( source, dest, filters = null ) {
    await makeDir( dest );

    const globs = !filters || filters.len == 0 
        ? [ path.join( '**', '*' ) ]
        : filters;

    await src( globs, { base: source } )
        .dest( dest )
        .exec();
}