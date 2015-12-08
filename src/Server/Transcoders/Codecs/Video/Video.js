import Codec from '../Codec';

export default class Video extends Codec {
	videoTracks ( metadata ) {
		return metadata.streams.filter( stream => stream.codec_type === 'video' );
	}
}