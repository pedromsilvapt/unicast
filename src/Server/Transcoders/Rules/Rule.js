export default class Rule {
	constructor ( criteria, codecs ) {
		this.criteria = criteria;
		this.codec = codecs;
	}

	matches ( metadata ) {
		return true;
	}

	convert ( transcoder, metadata ) {
		return transcoder;
	}
}