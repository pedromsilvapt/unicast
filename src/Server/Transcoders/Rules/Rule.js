import Codec from '../Codecs/Codec';

export default class Rule extends Codec {
	matches ( metadata ) {
		return true;
	}

	convert ( transcoder, metadata ) {
		return transcoder;
	}
}