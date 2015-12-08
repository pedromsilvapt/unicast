import Rule from './Rule';
import RulesSet from './Set';
import is from 'is';

export default class Delegate extends Rule {
	constructor ( ...rules ) {
		super();

		this.rules = rules;
	}

	get rules () {
		return this._rules;
	}

	set rules ( rules ) {
		rules = rules.map( rule => {
			if ( is.array( rule ) ) {
				rule = new RulesSet( rule, { all: true } );
			}

			return rule;
		} );

		this._rules = rules;
	}

	get rule () {
		return this.rules[ 0 ];
	}

	set rule ( value ) {
		this.rules[ 0 ] = value;
	}

	matches ( metadata ) {
		return this.rule.matches( metadata );
	}

	convert ( transcoder, metadata ) {
		return this.rule.convert( transcoder, metadata );
	}
}

