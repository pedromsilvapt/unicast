export default class Codec {
	matches ( metadata ) {
		return true;
	}

	convert ( transcoder ) {
		return transcoder;
	}

	static make ( ...args ) {
		return new this( ...args );
	}
}