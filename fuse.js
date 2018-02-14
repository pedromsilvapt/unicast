const { FuseBox, JSONPlugin, RawPlugin } = require( "fuse-box" );

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

fuse.run();