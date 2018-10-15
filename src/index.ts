import { UnicastServer } from "./UnicastServer";
import { ChromecastReceiverFactory } from "./Receivers/ChromecastReceiver/ChromecastReceiverFactory";
import { FileSystemMediaProvider } from "./MediaProviders/FileSystemMediaProvider/FileSystemMediaProvider";
import { FFmpegDriverFactory } from "./Transcoding/FFmpegDriver/FFmpegDriver";
import { FFmpegHlsDriverFactory } from "./Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";
import { YoutubeMediaProvider } from "./MediaProviders/YoutubeProvider/YoutubeMediaProvider";
import { TheTVDB } from "./MediaScrapers/TheTVDB/TheTVDB";
import { TheMovieDB } from "./MediaScrapers/TheMovieDB/TheMovieDB";
import { FileSystemRepositoryFactory } from "./MediaRepositories/FileSystemRepository/FileSystemRepositoryFactory";
import { ToolFactory } from "./Tools/ToolsManager";
import { UpdatePathsTool } from "./Tools/UpdatePaths";
import { SetArtworkTool } from "./Tools/SetArtwork";
import { LoadArtworkTool } from "./Tools/LoadArtwork";
import { ExportDatabaseTool } from "./Tools/ExportDatabase";
import { TestTool } from "./Tools/Tool";

if ( !Symbol.asyncIterator ) {
    (Symbol as any).asyncIterator = Symbol( "Symbol.asyncIterator" );
}

const server = new UnicastServer();

server.receivers.factories.add( new ChromecastReceiverFactory( server ) );

server.repositories.factories.add( new FileSystemRepositoryFactory() );

server.providers.add( new FileSystemMediaProvider( 'filesystem' ) );
server.providers.add( new YoutubeMediaProvider( 'youtube' ) );

server.scrapers.add( new TheTVDB( 'B2038B70F41A5365' ) );
server.scrapers.add( new TheMovieDB( 'f090bb54758cabf231fb605d3e3e0468' ) );

server.transcoding.registerDriver( new FFmpegDriverFactory() );
server.transcoding.registerDriver( new FFmpegHlsDriverFactory() );

server.tools.add( new ToolFactory( UpdatePathsTool ) );
server.tools.add( new ToolFactory( SetArtworkTool ) );
server.tools.add( new ToolFactory( LoadArtworkTool ) );
server.tools.add( new ToolFactory( ExportDatabaseTool ) );
server.tools.add( new ToolFactory( TestTool ) );

server.run().catch( err => console.error( err.message, err.stack ) );
    

process.on( 'unhandledRejection', ( error : any ) => {
    console.error( error.message, error.stack );
} );

export { server };

export function close () {
    return server.close();
}
