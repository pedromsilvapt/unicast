import Emitter from 'emmett';

export default class Evented extends Emitter {
	on ( events, callback ) {
		return super.on( events, ( event ) => {
			callback( event, ...event.args );
		} );
	}

	once ( events, callback ) {
		return super.once( events, ( event ) => {
			callback( event, ...event.args );
		} );
	}

	emit ( event, ...args ) {
		return super.emit( event, args );
	}
}