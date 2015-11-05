import Server from './Server/Server';

// Controllers
import WatchController from './Server/Controllers/WatchController';
import DeviceController from './Server/Controllers/DeviceController';

// Providers
import YoutubeProvider from './Server/Providers/Youtube/Provider';
import LocalProvider from './Server/Providers/Local/Provider';

let server = new Server();

server.controller( WatchController );
server.controller( DeviceController );

server.providers.defaultProvider = 'local';
server.providers.register( new YoutubeProvider() );
server.providers.register( new LocalProvider() );

server.listen().then( status => {
	console.log( 'Server listening on http://' + status.ip + ':' + status.port );
}, ( error ) => {
	console.error( 'ERROR', error.message, error.stack );
} );

//import scanner from 'chromecast-scanner';
//import { Device } from 'chromecast-js'
//
//setTimeout( function () {
//
//	var media = {
//		url : 'http://192.168.0.4:3000/watch',
//		subtitles: [{
//			language: 'en-US',
//			url: 'http://192.168.0.4:3000/subtitles',
//			name: 'English'
//		}, {
//			language: 'es-ES',
//			url: 'http://carlosguerrero.com/captions_styled_es.vtt',
//			name: 'Spanish'
//		} ],
//		cover: {
//			title: 'Person of Interest - If-Then-Else',
//			url: 'https://walter.trakt.us/images/episodes/001/391/972/screenshots/thumb/08921cc0ab.jpg'
//		},
//		subtitles_style: {
//			backgroundColor: '#FFFFFF00', // see http://dev.w3.org/csswg/css-color/#hex-notation
//			foregroundColor: '#FFFFFFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
//			edgeType: 'DROP_SHADOW', // can be: "NONE", "OUTLINE", "DROP_SHADOW", "RAISED", "DEPRESSED"
//			edgeColor: '#000000FF', // see http://dev.w3.org/csswg/css-color/#hex-notation
//			fontScale: 1.5, // transforms into "font-size: " + (fontScale*100) +"%"
//			fontStyle: 'BOLD', // can be: "NORMAL", "BOLD", "BOLD_ITALIC", "ITALIC",
//			fontFamily: 'Droid Sans',
//			fontGenericFamily: 'CURSIVE', // can be: "SANS_SERIF", "MONOSPACED_SANS_SERIF", "SERIF", "MONOSPACED_SERIF", "CASUAL", "CURSIVE", "SMALL_CAPITALS",
//			windowColor: '#AA00FFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
//			windowRoundedCornerRadius: 10, // radius in px
//			windowType: 'ROUNDED_CORNERS' // can be: "NONE", "NORMAL", "ROUNDED_CORNERS"
//		}
//	};
//
//	scanner( function( err, service ) {
//		if ( !service ) {
//			console.log( err );
//
//			service = {
//				name: 'ChromeSilvas',
//				data: '192.168.0.17'
//			};
//		}
//
//		console.log( 'chromecast %s running on: %s',
//			service.name,
//			service.data );
//
//		let device = new Device( {
//			name: service.name,
//			addresses: [service.data]
//		} );
//
//		device.connect();
//		device.on( 'connected', function () {
//			console.log( 'connected' );
//
//			// Starting to play Big Buck Bunny (made in Blender) exactly in the first minute with example subtitles and cover.
//			device.play(media, 0, function(){
//				console.log('Playing in your chromecast!')
//
//				//device.changeSubtitles(0, function(err, status){
//				//	if(err) console.log("error restoring subtitles...")
//				//	console.log("subtitles restored.");
//				//});
//			} );
//		} );
//	} );
//}, 5000 );
