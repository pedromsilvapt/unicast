import StreamTranscoder from 'stream-transcoder';
import fs from 'fs-promise';

export default class Transcoder {
	valid ( metadata ) {
		return false;
	}

	process ( transcoder ) {

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

	run ( stream, part, metadata, list ) {
		let streamTranscoder = new StreamTranscoder( stream );
		let applied = 0;

		for ( let transcoder of list ) {
			if ( transcoder.valid( metadata ) ) {
				streamTranscoder = transcoder.process( streamTranscoder ) || streamTranscoder;

				applied += 1;
			}
		}

		if ( applied === 0 ) {
			return stream;
		}

		streamTranscoder.on( 'error', function ( error ) {
			if ( error.message !== 'FFmpeg error: Stream mapping:' ) {
				throw error;
			}
		} );

		streamTranscoder.on( 'progress', function ( progress ) {
			console.log( progress.progress || progress );
		} );

		streamTranscoder.on( 'finish', function ( progress ) {
			console.log( 'finish' );
		} );

		console.log( this.compileArgs( streamTranscoder ).join( ' ' ) );

		return streamTranscoder.stream();
	}
}