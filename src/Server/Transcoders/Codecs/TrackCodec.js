import Codec from './Codec';
import _ from 'lodash';

export default class TrackCodec extends Codec {
	constructor ( criteria = {} ) {
		super();

		this.criteria = criteria;
	}

	tracks ( metadata ) {
		return _.where( metadata.streams, this.criteria );
	}

	matches ( metadata ) {
		return this.tracks( metadata ).length > 0;
	}
}