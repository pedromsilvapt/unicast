import TrackCodec from '../TrackCodec';
import extend from 'extend';

export default class Video extends TrackCodec {
	constructor ( criteria ) {
		super( extend( { codec_type: 'video' }, criteria ) );
	}
}