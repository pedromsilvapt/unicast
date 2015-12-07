import AudioCodec from './Audio';

export default class AC3 extends AudioCodec {
	matches ( metadata ) {
		let audio = this.audioTracks( metadata );

		return audio.length > 0 && audio.some( stream => stream.codec_name == 'ac3' );
	}

	convert ( transcoder ) {
		return transcoder.audioCodec( 'ac3' ).custom( 'af', 'aresample=async=1000' );
	}
}