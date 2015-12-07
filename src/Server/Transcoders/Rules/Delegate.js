import Rule from './Rule';
import RulesSet from './Set';
import is from 'is';

export default class Delegate extends Rule {
	constructor ( rule, options = {} ) {
		super();

		this.rule = rule;
	}

	get rule () {
		return this._rule;
	}

	set rule ( rule ) {
		if ( is.array( rule ) ) {
			rule = new RulesSet( rule, { all: true } );
		}

		this._rule = rule;
	}

	matches ( metadata ) {
		return this.rule.matches( metadata );
	}

	convert ( transcoder, metadata ) {
		return this.rule.convert( transcoder, metadata );
	}
}

