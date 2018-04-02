import { Readable, Writable, WritableOptions, PassThrough } from "stream";
import * as fs from "mz/fs";

export type StreamFactory = ( start ?: number, end ?: number ) => NodeJS.ReadableStream;

export class BytesCountStream extends Writable {
    count : number = 0;

    constructor ( options ?: WritableOptions ) {
        super( options );
    }

    
    _write ( chunk : Buffer | string, encoding : string, cb : Function ) {
        this.count += chunk.length;
        
        cb();
    }
}

export interface ResilientStreamOptions {
    start: number;
    end: number;
    maxRetries : number;
    nextInterval : ( lastTimeout : number, index : number ) => number;
    retriableErrors: string[];
}

export class ResilientReadStream extends PassThrough {
    options : ResilientStreamOptions;

    _createStream : StreamFactory;

    protected stream : NodeJS.ReadableStream;

    retries : number = 0;

    retryInterval : number = 0;

    queuedBytes : number = 0;

    get readBytes () : number {
        return this.counter.count;
    }

    counter : BytesCountStream = new BytesCountStream();

    constructor ( createStream : StreamFactory, options : Partial<ResilientStreamOptions> = {} ) {
        super();

        this._createStream = createStream;
        this.options = {
            start: void 0,
            end: void 0,
            maxRetries: 4,
            nextInterval: ( t, i ) => 400 * Math.pow( i, 2 ),
            retriableErrors: [ 'EACCES', 'ECONNREFUSED', 'EEXIST', 'EMFILE', 'ENOENT', 'ETIMEDOUT', 'UNKNOWN' ],
            ...options
        };

        this.createStream();
    }

    protected createStream () {
        try {
            this.stream = this._createStream( this.options.start + this.readBytes, this.options.end );

            this.stream.once( 'error', ( error ) => {
                this.retryOrFail( error );
            } ).pipe( this );

            this.stream.pipe( this.counter );

            this.retries = 0;
            this.retryInterval = 0;
        } catch ( error ) {
            this.retryOrFail( error );
        }
    }

    protected retryOrFail ( error : Error ) {
        if ( this.stream ) {
            this.stream.unpipe( this );
            this.stream.unpipe( this.counter );

            this.stream = null;
        }

        if ( this.retries < this.options.maxRetries && this.options.retriableErrors.indexOf( ( error as any ).code ) !== -1 ) {
            return this.retry();
        }

        this.fail( error );        
    }

    protected fail ( error : Error ) {
        this.emit( 'error', error );
    }

    protected retry () {
        this.retries++;
        
        this.retryInterval = this.options.nextInterval( this.retryInterval, this.retries );
        
        setTimeout( () => this.createStream(), this.retryInterval );
    }
}

export class FsReadResilientStream extends ResilientReadStream {
    constructor ( file : string, options : Partial<ResilientStreamOptions> = {} ) {
        super( ( start, end ) => fs.createReadStream( file, {
            start: start || 0,
            end: end
        } ), options );
    }
}
