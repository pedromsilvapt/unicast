export default class Codec {
	matches ( metadata ) {
		return true;
	}

	convert ( transcoder ) {
		return transcoder;
	}
}