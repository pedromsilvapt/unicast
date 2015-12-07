import ReceiverStatus from './ReceiverStatus';
import Evented from '../Server/Utilities/Evented';
import RulesSet from '../Server/Transcoders/Rules/Set';
import co from 'co';

export default class Receiver extends Evented {
	constructor ( name ) {
		super();

		this.name = name;

		this.status = new ReceiverStatus( this );

		this.transcoders = new RulesSet();
	}

	get current () {
		return this._currentItem;
	}

	set current ( value ) {
		return co( function * () {
			if ( this.current && this.current.status ) {
				yield this.current.status.stop( this.current );
			}

			this._currentItem = value;
		}.bind( this ) );
	}

	get playlist () {
		if ( !this.current ) {
			return null;
		}

		return this.current.playlist( this );
	}

	play ( item ) {
		this.current = item;
	}

	stop () {
		this.current = null;
	}
}