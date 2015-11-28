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

//let provider = new LocalProvider();
//
//let subtitles = [
//	//'Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	'Marvels.Jessica.Jones.S01E02.AKA.Crush.Syndrome.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E03.AKA.Its.Called.Whiskey.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E04.AKA.99.Friends.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E05.AKA.The.Sandwich.Saved.Me.1080p.NF.WEBRip.DD5.1.x264-SNEAkY'
//].map( f => 'J:\\Series\\Marvels Jessica Jones\\Season 1\\' + f ).map( file => {
//	return provider.itemEmbeddedSubtitles( file + '.mkv' ).then( function ( e ) {
//		return e.content( file + '.srt', {
//			onData: d => console.log( d.toString( 'utf-8' ) )
//		} );
//	} ).then( () => {
//		console.log( file, 'finished' );
//	} );
//} );
//
//Promise.all( subtitles ).catch( e => console.error( 'ERROR', e, e.message, e.stack ) );


//	e.extract( 'J:\\Series\\Marvels Jessica Jones\\Season 1\\Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY.srt', e => console.log( e.timemark ), {
//		onError: ( error ) => {
//			console.log( error );
//		},
//		onEnd: () => {
//			console.log( 'END' );
//		}
//	} );
//} );