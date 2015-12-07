import Rule from './Rule';
import RulesSet from './Set';
import is from 'is';

export default class Conditional extends Rule {
	constructor ( conditions, codecs ) {
		super();

		this.conditions = conditions;
		this.codecs = codecs;
	}

	get conditions () {
		return this._conditions;
	}

	set conditions ( conditions ) {
		if ( is.array( conditions ) ) {
			conditions = new RulesSet( conditions, { all: true } );
		}

		this._conditions = conditions;
	}

	get codecs () {
		return this._codecs;
	}

	set codecs ( codecs ) {
		if ( is.array( codecs ) ) {
			codecs = new RulesSet( codecs, { all: true } );
		}

		this._codecs = codecs;
	}

	matches ( metadata ) {
		return this.conditions.matches( metadata );
	}

	convert ( transcoder, metadata ) {
		return this.codecs.convert( transcoder, metadata );
	}
}