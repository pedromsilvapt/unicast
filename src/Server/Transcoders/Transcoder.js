import StreamTranscoder from 'stream-transcoder';
import ff from 'fluent-ffmpeg';
import fs from 'fs-promise';
import co from 'co';

export default class Transcoder {
	constructor ( codec ) {
		this.codec = codec;
	}

	compileArgs ( streamTranscoder ) {
		let args = streamTranscoder._compileArguments();
		args.push( 'pipe:1' );

		if ( 'string' == typeof streamTranscoder.source ) {
			args = [ '-i', streamTranscoder.source ].concat( args );
		} else {
			args = [ '-i', '-' ].concat( args );
		}

		return args;
	}

	matches ( metadata ) {
		return this.codec && this.codec.matches( metadata );
	}

	exec ( streamTranscoder ) {
		var args = streamTranscoder._compileArguments();

		args.push( 'pipe:1' );

		return streamTranscoder._exec( args );
	}

	run ( stream, metadata ) {
		let streamTranscoder = new StreamTranscoder( stream );

		if ( !this.matches( metadata ) ) {
			return stream;
		}

		streamTranscoder = this.codec.convert( streamTranscoder, metadata );

		//streamTranscoder.format( 'matroska' );
		//streamTranscoder.custom( 'movflags', '+faststart' );

		streamTranscoder.on( 'error', function ( error ) {
			if ( error.message !== 'FFmpeg error: Stream mapping:' ) {
				throw error;
			}
		} );

		streamTranscoder.on( 'progress', function ( progress ) {
			//console.log( progress.progress || progress );
		} );

		streamTranscoder.on( 'finish', function ( progress ) {
			console.log( 'finish' );
		} );

		console.log( this.compileArgs( streamTranscoder ).join( ' ' ) );

		let child = this.exec( streamTranscoder );

		let result = child.stdout;

		result.end = () => {
			//streamTranscoder.stdout.unpipe( res );
			//child.stderr.unpipe( process.stdout );
			// SIGINT is apparently not being respected...
			child.kill( 'SIGKILL' );
		};

		return result;
	}
}