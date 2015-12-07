import Codec from '../Codec';

export default class MKV extends Codec {
	matches ( metadata ) {
		if ( metadata.format.format_name == 'matroska,webm' ) {
			return true;
		}

		return false;
	}

	convert ( transcoder ) {
		return transcoder.format( 'matroska' );
	}
}