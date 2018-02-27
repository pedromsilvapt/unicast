const { FuseBox, JSONPlugin, RawPlugin } = require( "fuse-box" );
const { task, src, watch, tsc } = require( "fuse-box/sparky" );
const fs = require( 'mz/fs' );

task( 'build', async context => {
    const fuse = FuseBox.init( {
        homeDir : "src",
        target : 'server@es6',
        output : "dist/$name.js",
        useTypescriptCompiler : true,
        plugins: [ 
            JSONPlugin(),
            RawPlugin( [ '.txt.js', '.txt', '.txt.ts' ] )
        ]
    } );
    
    fuse.bundle( "vendor" )
        .instructions( "~ index.ts" )
    
    fuse.bundle( "app" )
        .completed( proc => proc.start() )
        .instructions( "> [index.ts]" ).watch()
    
    await fuse.run();
} );

task( 'check', async context => {
    await tsc( __dirname, {
        ...JSON.parse( ( await fs.readFile( 'tsconfig.json', 'utf8' ) ) ).compilerOptions,
        noEmit: true,
        watch: true
    } );
} );

task( 'default', [ 'build' ] );