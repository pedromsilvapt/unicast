import Cluster from './Server/Cluster';
import logger from './Server/Logger';

let cluster = new Cluster();

logger.addTag( { msg: cluster.isMaster ? 'Master' : 'Worker', colors: 'red' } );
cluster.listen().then( status => {
	logger.message( 'Server listening on http://' + status.ip + ':' + status.port );
} ).catch( ( error ) => {
	console.error( 'ERROR', error.message, error.stack );
} );

//import LocalProvider from './Server/Providers/Local/Provider';
//
//let provider = new LocalProvider();
//
//let file = 'J:\\Series\\Marvels Jessica Jones\\Season 1\\Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY.mkv';
//
//let stream = provider.video( file );
//
//stream.metadata.then( m => {
//	console.log( m.format );
//} );

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