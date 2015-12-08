import AudioCodec from './Audio';
import extend from 'extend';

export default class AAC extends AudioCodec {
	constructor () {
		super( { codec_name: 'aac' } );
	}

	convert ( transcoder ) {
		return transcoder.audioCodec( 'aac' ).custom( 'af', 'aresample=async=1000' );
	}
}