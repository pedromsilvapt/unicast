import AudioCodec from './Audio';
import extend from 'extend';

export default class AC3 extends AudioCodec {
	constructor () {
		super( { codec_name: 'ac3' } );
	}

	convert ( transcoder ) {
		return transcoder.audioCodec( 'ac3' ).custom( 'af', 'aresample=async=1000' ).audioBitrate( '320k' );
	}
}