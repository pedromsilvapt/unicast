import Delegate from './Delegate';

export default class Or extends Delegate {
	constructor ( ...rules ) {
		super( ...rules );
	}

	matches ( metadata ) {
		for ( let rule of this.rules ) {
			if ( rule.matches( metadata ) ) {
				return true;
			}
		}

		return false;
	}
}