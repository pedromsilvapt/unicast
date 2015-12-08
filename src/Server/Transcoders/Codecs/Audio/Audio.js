import TrackCodec from '../TrackCodec';
import extend from 'extend';

export default class Audio extends TrackCodec {
	constructor ( criteria ) {
		super( extend( { codec_type: 'audio' }, criteria ) );
	}
}