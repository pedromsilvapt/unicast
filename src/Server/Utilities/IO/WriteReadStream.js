import { Duplex } from 'stream';
import fs from 'fs-promise';

export default class WriteReadStream extends Duplex {
	constructor ( destination ) {
		super();

		if ( destination ) {
			this.destination = destination;
			this.writer = this.createWriter( destination );
		}

		this.sent = 0;
		this.waiting = 0;
		this.written = 0;
		this.received = 0;
		this.writingEnded = false;

		this.sendQueue = Promise.resolve( null );

		this.watchers = [];

		this.on( 'end', this._destroy.bind( this ) );
	}

	createWriter ( destination ) {
		let writer = fs.createWriteStream( destination );

		writer.on( 'finish', () => {
			this.writingEnded = true;

			if ( this.sent == this.received ) {
				this.push( null );
			}
		} );

		return writer;
	}

	dispatchWatchers () {
		let notified = 0;

		for ( let watcher of this.watchers ) {
			if ( watcher.part <= this.written && !watcher.notified ) {
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

	end ( ...args ) {
		this.writer.end( ...args );

		super.end( ...args );
	}

	_destroy () {
		this.writer.end();
	}

	_write ( chunk, enc, cb ) {
		this.received += chunk.length;

		this.writer.write( chunk, enc, ( ...args ) => {
			cb( ...args );

			this.written += chunk.length;

			this.dispatchWatchers();
		} );


		if ( this.waiting > 0 ) {
			this.sendQueue = this.sendQueue.then( () => {
				let sending = Math.min( this.waiting, chunk.length );
				this.waiting -= sending;
				this.sent += sending;

				this.push( chunk.slice( 0, sending ) );

				if ( this.writingEnded && this.sent == this.received ) {
					this.push( null );
				}
			} );
		}
	}

	readBuffer ( start, end ) {
		return new Promise( ( resolve, reject ) => {
			try {
				fs.createReadStream( this.destination, { start: start, end: end - 1 } ).on( 'data', ( d ) => {
					this.push( d );
				} ).on( 'error', ( error ) => {
					reject( error );
				} ).on( 'end', () => {
					if ( this.writingEnded && end == this.written ) {
						this.push( null );
					}

					resolve();
				} );
			} catch ( error ) {
				reject( error );
			}
		} );
	}

	async send ( start, end ) {
		this.sendQueue = this.sendQueue.then( () => {
			return this.when( end );
		} ).then( () => {
			return this.readBuffer( start, end );
		} );
	}


	_read ( size ) {
		let have = Math.max( 0, Math.min( this.received - this.sent, size ) );

		if ( have > 0 ) {
			this.send( this.sent, this.sent + have );

			this.sent += have;
		}

		if ( !this.writingEnded ) {
			this.waiting += size - have;
		}
	}
}
