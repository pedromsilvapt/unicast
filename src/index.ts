import { UnicastServer } from "./UnicastServer";
import { ChromecastReceiverFactory } from "./Receivers/ChromecastReceiver/ChromecastReceiverFactory";
import { FileSystemMediaProvider } from "./MediaProviders/FileSystemMediaProvider/FileSystemMediaProvider";
import { KodiMediaProviderFactory } from "./MediaProviders/KodiMediaProvider/KodiMediaProviderFactory";
import { FFmpegDriverFactory } from "./Transcoding/FFmpegDriver/FFmpegDriver";
import { FFmpegHlsDriverFactory } from "./Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";
import { YoutubeMediaProvider } from "./MediaProviders/YoutubeProvider/YoutubeMediaProvider";

if ( !Symbol.asyncIterator ) {
    (Symbol as any).asyncIterator = Symbol( "Symbol.asyncIterator" );
}

const server = new UnicastServer();

server.receivers.factories.add( new ChromecastReceiverFactory( server ) );
server.providers.factories.add( new KodiMediaProviderFactory( server ) );
server.providers.add( new FileSystemMediaProvider( 'filesystem' ) );
server.providers.add( new YoutubeMediaProvider( 'youtube' ) );

server.transcoding.registerDriver( new FFmpegDriverFactory() );
server.transcoding.registerDriver( new FFmpegHlsDriverFactory() );

server.listen().catch( err => console.error( err.message, err.stack ) );

export { server };

export function close () {
    return server.close();
}
