import AudioCodec from './Audio';

export default class AAC extends AudioCodec {
	matches ( metadata ) {
		let audio = this.audioTracks( metadata );

		return audio.length > 0 && audio.some( stream => stream.codec_name == 'aac' );
	}

	convert ( transcoder ) {
		return transcoder.audioCodec( 'ac3' ).custom( 'af', 'aresample=async=1000' ).audioBitrate( '320k' );
	}
}