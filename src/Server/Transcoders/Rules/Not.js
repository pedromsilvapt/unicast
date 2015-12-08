import Delegate from './Delegate';

export default class Not extends Delegate {
	constructor ( rule ) {
		super( rule );
	}

	matches ( metadata ) {
		return !super.matches( metadata );
	}
}