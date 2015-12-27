import Delegate from './Delegate';

export default class Conditional extends Delegate {
	constructor ( conditions, then, fallback ) {
		super( conditions, then, fallback );
	}

	get conditions () {
		return this.rules[ 0 ];
	}

	get then () {
		return this.rules[ 1 ];
	}

	get fallback () {
		return this.rules[ 2 ];
	}

	matches ( metadata ) {
		if ( this.fallback ) {
			return this.conditions.matches( metadata ) || this.fallback.matches( metadata );
		}

		return this.conditions.matches( metadata );
	}

	convert ( transcoder, metadata ) {
		if ( this.conditions.matches( metadata ) ) {
			return this.then.convert( transcoder, metadata );
		} else if ( this.fallback ) {
			return this.fallback.convert( transcoder, metadata );
		}
	}
}