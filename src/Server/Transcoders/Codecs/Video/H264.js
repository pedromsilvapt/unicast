import VideoCodec from './Video';
import extend from 'extend';

export default class H264 extends VideoCodec {
	constructor () {
		super( { codec_name: 'h264' } );
	}

	convert ( transcoder ) {
		return transcoder.videoCodec( 'libx264' ).custom( 'tune', 'zerolatency' ).videoBitrate( '4000k' );
	}
}