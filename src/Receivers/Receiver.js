import ReceiverStatus from './ReceiverStatus';
import co from 'co';

export default class Receiver {
	constructor ( name ) {
		this.name = name;

		this.status = new ReceiverStatus( this );
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