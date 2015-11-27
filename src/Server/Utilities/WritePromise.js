import { Writable } from 'stream';
import Deferred from './Deferred';

export default class WritePromise extends Writable {
	constructor ( save = true ) {
		super();

		this.save = save;
		this.buffers = [];

		this.deferred = new Deferred();

		this.on( 'end', this.onEnd.bind( this ) );
		this.on( 'error', this.onError.bind( this ) );
	}

	get content () {
		return this.deferred.promise;
	}

	write ( data ) {
		this.buffers.push( ( data instanceof Buffer ) ? data : new Buffer( data ) );
	}

	onError ( error ) {
		this.buffers = null;

		this.deferred.reject( error );
	}

	onEnd () {
		if ( this.save ) {
			this.deferred.resolve( Buffer.concat( this.buffers ) );
		}

		this.deferred.resolve();
	}
}