import Delegate from './Rule';
import extend from 'extend';

export default class Shared extends Delegate {
	constructor ( rule, options = {} ) {
		super( rule );

		this.called = 0;

		this.options = extend( {
			count: 1
		}, options );
	}

	reset () {
		this.called = 0;
	}

	convert ( transcoder, metadata ) {
		if ( this.called < this.options.limit ) {
			this.called += 1;

			return super.convert( transcoder, metadata );
		}

		return transcoder;
	}
}