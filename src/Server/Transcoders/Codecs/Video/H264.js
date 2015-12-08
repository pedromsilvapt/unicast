import VideoCodec from './Video';

export default class H264 extends VideoCodec {
	matches ( metadata ) {
		let video = this.videoTracks( metadata );

		//console.log( video );

		return video.length > 0 && video.some( stream => stream.codec_name == 'h264' );
	}

	convert ( transcoder ) {
		return transcoder.videoCodec( 'libx264' ).custom( 'tune', 'zerolatency' ).videoBitrate( '4000k' );
	}
}