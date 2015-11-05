import StreamCache from 'stream-cache';
import fs from 'fs-promise';

export default class RemoteVideo {
	constructor ( incoming ) {
		this.incoming = incoming;
		this.watchers = [];
		this.finished = false;
		this.received = 0;
		this.total = 0;

		this.save();
	}

	save () {
		this.incoming.on( 'data', ( chunk ) => {
			this.received += chunk.length;

			this.dispatchWatchers();
		} );

		this.outgoing = fs.createWriteStream( 'D:\\Pedro Silva\\Desktop\\video.mp4' );

		this.outgoing.on( 'finish', () => {
			this.finished = true;

			if ( this.total ) {
				Promise.resolve( this.total ).then( ( t ) => this.received = t );
			}

			this.dispatchWatchers();
		} );

		this.cache = new StreamCache();

		this.incoming.pipe( this.cache );

		this.incoming.pipe( this.outgoing );
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

	read ( options ) {
		if ( !this.finished ) {
			return this.cache;
			return fs.createReadStream( 'D:\\Pedro Silva\\Desktop\\video.mp4' );
		}

		return this.cache;
		return fs.createReadStream( 'D:\\Pedro Silva\\Desktop\\video.mp4', options );
	}
}