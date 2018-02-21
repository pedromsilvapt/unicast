import { UnicastServer } from "./UnicastServer";
import { ChromecastReceiverFactory } from "./Receivers/ChromecastReceiver/ChromecastReceiverFactory";
import { KodiMediaProvider } from "./MediaProviders/KodiMediaProvider/KodiMediaProvider";
import { FileSystemMediaProvider } from "./MediaProviders/FileSystemMediaProvider/FileSystemMediaProvider";
import { KodiMediaProviderFactory } from "./MediaProviders/KodiMediaProvider/KodiMediaProviderFactory";
import { FFmpegDriverFactory } from "./Transcoding/FFmpegDriver/FFmpegDriver";
import { FFmpegHlsDriverFactory } from "./Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";

(Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol( "Symbol.asyncIterator" );

const server = new UnicastServer();

server.receivers.factories.add( new ChromecastReceiverFactory( server ) );
server.providers.factories.add( new KodiMediaProviderFactory( server ) );
server.providers.add( new FileSystemMediaProvider( 'filesystem' ) );

server.transcoding.registerDriver( new FFmpegDriverFactory() );
server.transcoding.registerDriver( new FFmpegHlsDriverFactory() );

server.listen().catch( err => console.error( err.message, err.stack ) );