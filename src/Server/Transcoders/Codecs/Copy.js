import Codec from './Codec';

export default class Copy extends Codec {
	convert ( transcoder ) {
		return transcoder.videoCodec( 'copy' ).audioCodec( 'copy' );
	}
}