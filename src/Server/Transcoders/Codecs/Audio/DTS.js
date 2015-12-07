import AudioCodec from './Audio';

export default class DTS extends AudioCodec {
	matches ( metadata ) {
		let audio = this.audioTracks( metadata );

		return audio.length > 0 && audio.some( stream => stream.codec_name == 'dca' );
	}
}