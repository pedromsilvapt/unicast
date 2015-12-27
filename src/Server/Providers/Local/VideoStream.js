import DefaultVideoStream from '../Default/VideoStream';
import WritePromise from '../../Utilities/WritePromise';
import LiveVideo from '../../Utilities/LiveVideo';
import Deferred from '../../Utilities/Deferred';
import { Buffered, Live } from '../StreamTypes';
import FFMpeg from '../../Utilities/FFMpeg';
import { PassThrough } from 'stream';
import extend from 'extend';
import fs from 'fs-promise';
import mime from 'mime';
import is from 'is';

// Transcoders
import Transcoder from '../../Transcoders/Transcoder';

export default class VideoStream extends DefaultVideoStream {
	constructor ( filePath, receiver = null ) {
		super( receiver );
		this.filePath = filePath;
		this.transcodeStartDelay = 4000;

		this.embedded = new EmbeddedObjects( this );
	}

	get metadata () {
		return FFMpeg.probe( this.filePath );
	}

	get streamType () {
		return this.metadata.then( metadata => {
			let transcoder = this.receiver.transcoders;

			return transcoder.matches( metadata ) ? Live : Buffered;
		} );
	}

	get live () {
		return this.streamType.then( type => type === Live );
	}

	get size () {
		return fs.stat( this.filePath ).then( stat => stat.size );
	}

	get type () {
		return this.streamType;
	}

	get mime () {
		return mime.lookup( this.filePath );
	}

	async transcode ( transcoders = null ) {
		let metadata = await this.metadata;

		let transcoder = this.receiver.transcoders;

		let stream = transcoder.request( fs.createReadStream( this.filePath ), metadata, this.filePath, new LiveVideo() ).createReader();

		if ( is.number( this.transcodeStartDelay ) ) {
			await ( new Promise( ( resolve ) => setTimeout( resolve, this.transcodeStartDelay ) ) );
		}

		return stream;
	}

	async read ( offset = null ) {
		if ( await this.streamType == Live ) {
			return this.transcode( offset || {} );
		}

		if ( offset ) {
			return fs.createReadStream( this.filePath, {
				start: offset.start, end: offset.end
			} );
		}

		return fs.createReadStream( this.filePath )
	}
}

export class EmbeddedObjects {
	constructor ( stream ) {
		this.stream = stream;

		this._subtitles = null;
	}

	async subtitles ( language = null ) {
		if ( !this._subtitles ) {
			let metadata = await this.stream.metadata;

			this._subtitles = metadata.streams.filter( s => s.codec_type === 'subtitle' ).map( ( s, i ) => {
				return new EmbeddedSubtitle( this.stream, s, i );
			} );
		}

		return this._subtitles.filter( s => !language || s.language == language );
	}
}

export class EmbeddedSubtitle {
	constructor ( stream, object, index ) {
		this.stream = stream;
		this.object = object;
		this.index = index;
	}

	get language () {
		if ( 'TAG:language' in this.object ) {
			return this.object[ 'TAG:language' ];
		}

		return null;
	}

	extractParams ( destinations, onProgress, options ) {
		if ( destinations && !is.string( destinations ) && !is.array( destinations ) && !( destinations instanceof Stream ) ) {
			options = onProgress;
			onProgress = destinations;
			destinations = [];
		}

		if ( is.object( onProgress ) ) {
			options = onProgress;
			onProgress = null;
		}

		if ( destinations && !is.array( destinations ) ) {
			destinations = [ destinations ];
		} else if ( !destinations ) {
			destinations = [];
		}

		destinations = destinations.map( destination => {
			if ( is.string( destination ) ) {
				destination = fs.createWriteStream( destination );
			}

			return destination;
		} );

		return [ destinations, onProgress, options ];
	}

	extract ( destinations = null, onProgress = null, options = {} ) {
		[ destinations, onProgress, options ] = this.extractParams( destinations, onProgress, options );

		let command = FFMpeg.open( this.stream.filePath );

		command.outputOptions( [
			'-map 0:s:' + this.index,
			'-c:s copy', '-f srt'
		] );

		let passthrough = new PassThrough();

		let output = multi( destinations.concat( [ passthrough ] ), { autoDestroy: false } );

		command.addOutput( output );

		command.on( 'error', ( error ) => {
			if ( is.fn( options.onError ) ) {
				options.onError( error );
			}
		} ).on( 'progress', ( progress ) => {
			if ( onProgress ) {
				onProgress( progress );
			}

			if ( is.fn( options.onProgress ) ) {
				options.onProgress( progress );
			}
		} ).on( 'end', () => {
			if ( is.fn( options.onEnd ) ) {
				options.onEnd();
			}
		} );

		passthrough.on( 'data', ( data ) => {
			if ( is.fn( options.onData ) ) {
				options.onData( data );
			}
		} );

		command.run();

		return passthrough;
	}

	async content ( destinations = null, onProgress = null, options = {} ) {
		[ destinations, onProgress, options ] = this.extractParams( destinations, onProgress, options );

		let deferred = new Deferred();
		let output = new WritePromise();

		destinations.push( output );

		let passOptions = extend( {}, options, {
			onError: ( error ) => {
				deferred.reject( error );

				if ( options.onError ) {
					options.onError( error );
				}
			}
		} );

		this.extract( destinations, onProgress, passOptions );

		let content = await output.content;

		if ( options.encoding ) {
			return content.toString( options.encoding );
		}

		deferred.resolve( content );

		return deferred.promise;
	}
}