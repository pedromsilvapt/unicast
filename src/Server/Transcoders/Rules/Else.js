import Delegate from './Delegate';

export default class Else extends Delegate {
	constructor ( codec ) {
		super( codec );
	}

	get codec () {
		return this.rules[ 0 ];
	}

	matches ( metadata ) {
		return true;
	}

	convert ( transcoder, metadata ) {
		return this.codec.convert( transcoder, metadata );
	}
}