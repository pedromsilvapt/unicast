const { FuseBox, JSONPlugin, RawPlugin, QuantumPlugin } = require( "fuse-box" );
const { task, src, watch, tsc } = require( "fuse-box/sparky" );
const fs = require( 'mz/fs' );

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

task( 'check', async context => {
    await tsc( __dirname, {
        ...JSON.parse( ( await fs.readFile( 'tsconfig.json', 'utf8' ) ) ).compilerOptions,
        noEmit: true,
        watch: true
    } );
} );

task( 'default', [ 'build:dev' ] );
