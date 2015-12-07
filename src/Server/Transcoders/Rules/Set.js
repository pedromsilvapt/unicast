import Rule from './Rule';
import extend from 'extend';
import is from 'is';

export default class Set extends Rule {
	constructor ( rules = [], options = {} ) {
		super();

		this.rules = rules;
		this.options = new SetOptions( options );
	}

	matchedRules ( metadata ) {
		return this.rules.filter( rule => {
			return rule.matches( metadata );
		} );
	}

	matches ( metadata ) {
		let matched = this.matchedRules( metadata );

		if ( this.options.all && ( matched.length == 0 || matched.length < this.rules.length ) ) {
			return false;
		}

		return matched.length > 0;
	}

	convert ( transcoder, metadata ) {
		let rules = this.options.all ? this.rules : this.matchedRules( metadata );

		if ( rules.length > 0 ) {
			rules = this.options.prepend.concat( rules ).concat( this.options.append );
		}

		for ( let codec of rules ) {
			codec.convert( transcoder, metadata );
		}

		return transcoder;
	}
}

export class SetOptions {
	constructor ( options ) {
		extend( this, {
			prepend: [],
			append: []
		}, options );
	}

	get prepend () {
		return this._prepend || [];
	}

	set prepend ( value ) {
		if ( value && !is.array( value ) ) {
			value = [ value ];
		} else if ( !value ) {
			value = [];
		}

		this._prepend = value;
	}

	get append () {
		return this._append || [];
	}

	set append ( value ) {
		if ( value && !is.array( value ) ) {
			value = [ value ];
		} else if ( !value ) {
			value = [];
		}

		this._append = value;
	}
}