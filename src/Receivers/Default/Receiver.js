import ReceiverStatus from './ReceiverStatus';
import Evented from '../../Server/Utilities/Evented';
import RulesSet from '../../Server/Transcoders/Rules/Set';
import Sender from './Sender';

export default class Receiver extends Evented {
	constructor ( name ) {
		super();

		this.name = name;

		this.status = new ReceiverStatus( this );

		this.transcoders = new RulesSet();
	}

	get type () {
		return this.constructor.type;
	}

	createSender ( router ) {
		return new Sender( router );
	}

	get current () {
		return this._currentItem;
	}

	async setCurrent ( value ) {
		if ( this.current && this.current.status ) {
			await this.current.status.stop( this.current );
		}

		this._currentItem = value;
	}

	get playlist () {
		if ( !this.current ) {
			return null;
		}

		return this.current.playlist( this );
	}

	async play ( item ) {
		await this.setCurrent( item );
	}

	async stop () {
		await this.setCurrent( null );
	}
}