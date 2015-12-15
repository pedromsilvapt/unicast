import is from 'is';

export default class Deconstructor {
	static register ( listeners = null ) {
		if ( !listeners ) {
			listeners = this.defaultListeners;
		}

		if ( !is.array( listeners ) ) {
			listeners = [];
		}

		listeners = listeners.filter( l => !this.registered.has( l ) );

		if ( listeners ) {
			return;
		}

		for ( let listener of listeners ) {
			listener( this.close, this );

			this.registered.listener.add( listener );
		}

		return;
	}

	static close () {
		console.log( 'deconstruct' );
		process.emit( 'deconstruct' );
	}

	constructor ( action = null ) {
		Deconstructor.register();

		this.actions = [];

		if ( action ) {
			this.actions.push( action );
		}

		process.on( 'cleanup', this.trigger.bind( this ) );
	}

	trigger () {
		for ( let action of this.actions ) {
			action();
		}
	}
}

Deconstructor.registered = new Set();
Deconstructor.defaultListeners = [];

Deconstructor.defaultListeners.push( close => {
	// do app specific cleaning before exiting
	process.on( 'exit', () => {
		close();
	} );
} );
Deconstructor.defaultListeners.push( close => {
	// catch ctrl+c event and exit normally
	process.on( 'SIGINT', () => {
		close();

		console.log( 'Ctrl-C...' );
	} );
} );
Deconstructor.defaultListeners.push( ( close ) => {
	// catch ctrl+c event and exit normally
	process.on( 'SIGHUP', () => {
		close();

		console.log( 'Ctrl-C...' );
	} );
} );
Deconstructor.defaultListeners.push( close => {
	// catch ctrl+c event and exit normally
	process.on( 'SIGTERM', () => {
		close();

		console.log( 'Ctrl-C...' );
	} );
} );
Deconstructor.defaultListeners.push( close => {
	//catch uncaught exceptions, trace, then exit normally
	process.on( 'uncaughtException', ( e ) => {
		console.log( 'Uncaught Exception...' );
		console.log( e.stack );

		close();
	} );
} );