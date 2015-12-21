import StreamTranscoder from 'stream-transcoder';
import ff from 'fluent-ffmpeg';
import fs from 'fs-promise';

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

		var formatTime = ( duration ) => {
			let milliseconds = duration % 1000;

			let seconds = parseInt( duration / 1000, 10 ) % 60;

			let minutes = parseInt( duration / ( 60 * 1000 ), 10 ) % 60;

			let hours = parseInt( duration / ( 60 * 60 * 1000 ), 10 );

			return [ hours, minutes, seconds, milliseconds ];
		};

		var elapsed_time = ( start, precision = 3 ) => {
			let elapsed = process.hrtime( start ); // divide by a million to get nano to milli

			let milliseconds = elapsed[ 1 ] / 1000000;

			//process.hrtime( start )[0] + " s, " + elapsed.toFixed(precision) + " ms - " + note); // print message + time
			return ( elapsed[ 0 ] * 1000 ) + parseFloat( milliseconds.toFixed( precision ) ); // reset the timer
		};

		let lastBench = null;
		let lastTime = null;
		streamTranscoder.on( 'progress', function ( progress ) {
			try {
				if ( lastBench !== null ) {
					let diff = elapsed_time( lastBench );

					let speed = ( progress.time ) / diff;
					console.log( speed + ' /s', formatTime( progress.time  ).join( ':' ), progress.time, progress.frame );
				} else {
					console.log( progress.time );
					lastBench = process.hrtime();
				}

				lastTime = progress.time;
			} catch ( error ) {
				console.log( error.message, error.stack )
			}
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