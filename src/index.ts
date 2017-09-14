import { UnicastServer } from "./UnicastServer";
import { ChromecastReceiverFactory } from "./Receivers/ChromecastReceiver/ChromecastReceiverFactory";
import { KodiMediaProvider } from "./MediaProviders/KodiMediaProvider/KodiMediaProvider";
import { FileSystemMediaProvider } from "./MediaProviders/FileSystemMediaProvider/FileSystemMediaProvider";
import { KodiMediaProviderFactory } from "./MediaProviders/KodiMediaProvider/KodiMediaProviderFactory";

(Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol( "Symbol.asyncIterator" );

const server = new UnicastServer();

server.receivers.factories.add( new ChromecastReceiverFactory( server ) );
server.providers.factories.add( new KodiMediaProviderFactory( server ) );
server.providers.add( new FileSystemMediaProvider( 'filesystem' ) );

server.listen().catch( console.error.bind( console ) );