export default class RemoteVideo {
	constructor ( source ) {
		this.source = source;
		this.watchers = [];
	}

	createReadStream ( offset ) {

	}

	dispatchWatchers () {
		let notified = 0;

		for ( let watcher of this.watchers ) {
			if ( watcher.part <= this.received && !watcher.notified ) {
				watcher.resolve( watcher.part );

				watcher.notified = true;

				notified += 1;
			}
		}

		if ( notified >= 5 ) {
			this.watchers = this.watchers.filter( w => !w.notified );
		}

		return notified;
	}

	when ( part ) {
		if ( part <= this.received ) {
			return Promise.resolve( part );
		}

		return new Promise( ( resolve, reject ) => {
			this.watchers.push( {
				part, resolve, reject
			} );
		} );
	}

	read ( options = null ) {
		this.incoming = this.createReadStream( options );

		this.incoming.on( 'data', ( chunk ) => {
			this.received += chunk.length;

			this.dispatchWatchers();
		} );

		this.incoming.on( 'end', async () => {
			this.finished = true;

			if ( this.total ) {
				this.received = await Promise.resolve( this.total );
			}

			this.dispatchWatchers();
		} );

		return this.incoming;
	}
}