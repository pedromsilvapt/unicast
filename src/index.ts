import { UnicastServer } from "./UnicastServer";
import { FFmpegDriverFactory } from "./Transcoding/FFmpegDriver/FFmpegDriver";
import { FFmpegHlsDriverFactory } from "./Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";

if ( !Symbol.asyncIterator ) {
    (Symbol as any).asyncIterator = Symbol( "Symbol.asyncIterator" );
}

const server = new UnicastServer();

server.transcoding.registerDriver( new FFmpegDriverFactory() );
server.transcoding.registerDriver( new FFmpegHlsDriverFactory() );

server.tools.addFolder( 'lib/Tools' )
    .then( () => server.run() )
    .catch( err => console.error( err.message, err.stack ) )
    .then( () => process.exit() );
    

process.on( 'unhandledRejection', ( error : any ) => {
    console.error( error.message, error.stack );
} );

export { server };

export function close () {
    return server.close();
}
