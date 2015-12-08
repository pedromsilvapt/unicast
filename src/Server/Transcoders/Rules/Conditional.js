import Delegate from './Delegate';
import RulesSet from './Set';
import is from 'is';

export default class Conditional extends Delegate {
	constructor ( conditions, codecs ) {
		super( conditions, codecs );
	}

	get conditions () {
		return this.rules[ 0 ];
	}

	get codecs () {
		return this.rules[ 1 ];
	}

	matches ( metadata ) {
		return this.conditions.matches( metadata );
	}

	convert ( transcoder, metadata ) {
		return this.codecs.convert( transcoder, metadata );
	}
}