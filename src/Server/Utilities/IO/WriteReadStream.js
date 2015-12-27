import { Duplex, Readable } from 'stream';
import Kefir from 'kefir';
import fs from 'fs-promise';
import extend from 'extend';

export default class WriteReadStream extends Duplex {
	constructor ( destination ) {
		super();

		if ( destination ) {
			this.destination = destination;
			this.writer = this.createWriter( destination );
		}

		this.reader = this.createReader();

		this.written = 0;
		this.received = 0;
		this.writingEnded = false;

		this.watchers = [];
		this.requests = [];

		this.on( 'finish', this.onFinish.bind( this ) );
	}

	onFinish () {
		console.log( 'FINISH' );
		this.writer.end();
	}

	createWriter ( destination ) {
		let writer = fs.createWriteStream( destination );

		writer.on( 'finish', () => {
			this.writingEnded = true;

			this.releaseAllRequests();
		} );

		return writer;
	}

	createReader ( offset = {} ) {
		return new ReadStream( this, offset = {} );
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

	_write ( chunk, enc, cb ) {
		this.received += chunk.length;

		this.writer.write( chunk, enc, ( ...args ) => {
			cb( ...args );

			this.written += chunk.length;

			this.dispatchWatchers();
		} );

		for ( let request of this.requests ) {
			let prefixOver = Math.max( 0, request.start - this.received - chunk.length );
			let suffixOver = Math.max( 0, this.received - request.end );

			let length = chunk.length - prefixOver - suffixOver;

			if ( length > 0 ) {
				chunk.slice( prefixOver ).copy( request.data.buffer, request.data.length, prefixOver, chunk.length - suffixOver );
			}

			request.data.length += length;

			if ( request.data.length === request.end - request.start ) {
				request.resolve( request.data.buffer );

				request.fulfilled = true;
			} else if ( this.writingEnded ) {
				request.resolve( request.data.buffer.slice( 0, request.data.length ) );

				request.fulfilled = true;
			}
		}

		this.requests = this.requests.filter( req => !req.fulfilled );
	}

	releaseAllRequests () {
		for ( let request of this.requests ) {
			request.resolve( request.data.buffer.slice( 0, request.data.length ) );
		}

		this.requests = [];
	}

	readBufferChunks ( start, end ) {
		return Kefir.stream( emitter => {
			fs.createReadStream( this.destination, { start: start, end: end - 1 } ).on( 'data', ( d ) => {
				emitter.emit( d );
			} ).on( 'error', ( error ) => {
				emitter.error( error );
			} ).on( 'end', () => {
				emitter.end();
			} );
		} );
	}

	addPendingRequest ( start, end ) {
		return new Promise( ( resolve, reject ) => {
			this.requests.push( {
				start: start,
				end: end,
				resolve: resolve,
				reject: reject,
				data: {
					buffer: new Buffer( end - start ),
					length: 0
				}
			} );
		} );
	}

	arrayToBuffer ( array ) {
		array = array.filter( e => e );

		if ( array.length == 0 ) {
			return null;
		}

		return Buffer.concat( array );
	}

	async request ( start, end ) {
		let buffers = [];
		let have = Math.max( 0, Math.min( this.received - start, end - start ) );

		if ( this.writingEnded && start >= this.received ) {
			return null;
		}

		if ( have > 0 ) {
			buffers.push( this.when( start + have ).then( () => {
				let buffers = this.readBufferChunks( start, start + have ).scan( ( memo, buffer ) => memo.concat( [ buffer ] ), [] ).last();

				return buffers.toPromise().then( this.arrayToBuffer );
			} ) );
		}

		if ( have < end - start && !this.writingEnded ) {
			buffers.push( this.addPendingRequest( start + have, end ) );
		}

		return Promise.all( buffers ).then( this.arrayToBuffer );
	}

	_read ( size ) {
		this.reader.readAsync( size ).then( data => {
			for ( let chunk of data ) {
				this.push( chunk );
			}
		} )
	}
}

export class ReadStream extends Readable {
	constructor ( source, offset = {} ) {
		super();

		this.destroyed = false;
		this.source = source;
		this.sent = 0;
		this.sendingQueue = Promise.resolve( 0 );
		this.offset = extend( {
			start: 0,
			end: null
		}, offset );
	}

	destroy () {
		this.destroyed = true;

		this.emit( 'close' );
	}

	readAsync ( size ) {
		return this.sendingQueue = this.sendingQueue.then( ()  => {
			let start = this.sent + this.offset.start;

			if ( this.offset.end ) {
				size = Math.min( size, this.offset.end - start );
			}

			return this.source.request( start, start + size ).then( ( data ) => {
				if ( this.destroyed ) {
					return [];
				}

				let result = [];

				result.push( data );

				if ( data ) {
					this.sent += data.length;

					if ( this.offset.end ) {
						if ( this.sent + this.offset.start == this.offset.end ) {
							result.push( null );
						}
					}
				}

				return result;
			} ).catch( e => console.error( e.message, e.stack ) );
		} );
	}

	_read ( size ) {
		this.readAsync( size ).then( data => {
			for ( let chunk of data ) {
				this.push( chunk );
			}
		} );
	}
}