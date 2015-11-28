//import streamToPromise from 'stream-to-promise';
import { Buffered, Live } from '../StreamTypes';
import FFMpeg from '../../Utilities/FFMpeg';
import rangeParser from 'range-parser';
import multi from 'multi-write-stream';
import { Stream, PassThrough } from 'stream';
import fs from 'fs-promise';
import through2 from 'through2';
import mime from 'mime';
import is from 'is';
import extend from 'extend';
import WritePromise from '../../Utilities/WritePromise';
import Deferred from '../../Utilities/Deferred';

// Transcoders
import Transcoder from '../../Transcoders/Transcoder';
import DTSAudio from '../../Transcoders/DTSAudio';

export default class VideoStream {
	constructor ( filepath ) {
		this.filepath = filepath;

		this.embedded = new EmbeddedObjects( this );
	}

	get metadata () {
		return FFMpeg.probe( this.filepath );
	}



	get type () {
		return this.metadata.then( metadata => {
			let transcoder = new Transcoder();

			return transcoder.valid( metadata, this.getTranscoders() ).length === 0 ? Buffered : Live;
		} );
	}

	getTranscoders () {
		return [ new DTSAudio() ];
	}

	async serve ( request, response ) {
		let metadata = await this.metadata;

		//console.log( metadata.streams.filter( s => s.codec_type === 'audio' ) );

		let stat = fs.statSync( this.filepath );
		let total = stat.size;
		let range = request.headers.range;
		let type = mime.lookup( this.filepath );

		response.set( 'Content-Type', type );
		response.set( 'Access-Control-Allow-Origin', '*' );

		let file;
		let part;
		if ( !range ) {
			console.log( 'norange', total );
			response.set( 'Content-Length', total );
			response.status = 200;

			file = fs.createReadStream( this.filepath );
		} else {
			part = rangeParser( total, range )[ 0 ];
			let chunksize = ( part.end - part.start ) + 1;

			file = fs.createReadStream( this.filepath, { start: part.start, end: part.end } );

			console.log( 'with range', part, total );

			response.set( 'Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total );
			response.set( 'Accept-Ranges', 'bytes' );
			response.set( 'Content-Length', chunksize );
			response.status = 206;
		}

		let transcoder = new Transcoder();

		return transcoder.run( file, part, metadata, [ new DTSAudio() ] );
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

		let command = FFMpeg.open( this.stream.filepath );

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