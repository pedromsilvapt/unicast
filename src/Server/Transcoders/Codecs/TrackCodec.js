import Codec from './Codec';
import _ from 'lodash';
import is from 'is';

export default class TrackCodec extends Codec {
	constructor ( criteria = {} ) {
		super();

		this.criteria = criteria;
	}

	tracks ( metadata, criteria ) {
		if ( is.undef( criteria ) ) {
			criteria = this.criteria;
		}

		return _.where( metadata.streams, criteria );
	}

	matches ( metadata ) {
		return this.tracks( metadata ).length > 0;
	}
}