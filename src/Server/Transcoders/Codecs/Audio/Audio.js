import Codec from '../Codec';

export default class Audio extends Codec {
	audioTracks ( metadata ) {
		return metadata.streams.filter( stream => stream.codec_type === 'audio' );
	}
}