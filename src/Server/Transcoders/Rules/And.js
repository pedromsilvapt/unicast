import Delegate from './Delegate';

export default class And extends Delegate {
	constructor ( ...rules ) {
		super( ...rules );
	}

	matches ( metadata ) {
		for ( let rule of this.rules ) {
			if ( !rule.matches( metadata ) ) {
				return false;
			}
		}

		return true;
	}
}