import Server from './Server/Server';

// Controllers
import WatchController from './Server/Controllers/WatchController';
import DeviceController from './Server/Controllers/DeviceController';

// Providers
import YoutubeProvider from './Server/Providers/Youtube/Provider';
import LocalProvider from './Server/Providers/Local/Provider';

// Receivers
import ChromecastReceiver from './Receivers/Chromecast/Receiver';

let server = new Server();

server.controller( WatchController );
server.controller( DeviceController );

server.providers.defaultProvider = 'local';
server.providers.register( new YoutubeProvider() );
server.providers.register( new LocalProvider() );

server.receivers.register( ChromecastReceiver );

server.listen().then( status => {
	console.log( 'Server listening on http://' + status.ip + ':' + status.port );
}, ( error ) => {
	console.error( 'ERROR', error.message, error.stack );
} );