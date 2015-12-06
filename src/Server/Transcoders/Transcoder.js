import StreamTranscoder from 'stream-transcoder';
import ff from 'fluent-ffmpeg';
import fs from 'fs-promise';
import co from 'co';

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

	valid ( metadata, list ) {
		let valid = [];

		for ( let transcoder of list ) {
			if ( transcoder.valid( metadata ) ) {
				valid.push( transcoder );
			}
		}

		return valid;
	}

	exec ( streamTranscoder ) {
		var args = streamTranscoder._compileArguments();

		args.push( 'pipe:1' );

		return streamTranscoder._exec( args );
	}

	run ( stream, metadata, list ) {
		let streamTranscoder = new StreamTranscoder( stream );

		list = this.valid( metadata, list );

		if ( list.length == 0 ) {
			return stream;
		}

		for ( let transcoder of list ) {
			streamTranscoder = transcoder.process( streamTranscoder ) || streamTranscoder;
		}

		streamTranscoder.format( 'matroska' );
		streamTranscoder.custom( 'movflags', '+faststart' );

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

	//run ( stream, part, metadata, list ) {
	//	return co( function * () {
	//		let streamTranscoder = ff( stream );
	//
	//		list = this.valid( metadata, list );
	//
	//		if ( list.length == 0 ) {
	//			return stream;
	//		}
	//
	//		for ( let transcoder of list ) {
	//			streamTranscoder = transcoder.process( streamTranscoder ) || streamTranscoder;
	//		}
	//
	//		streamTranscoder.on( 'error', function ( error ) {
	//			if ( error.message !== 'FFmpeg error: Stream mapping:' ) {
	//				throw error;
	//			}
	//		} );
	//
	//
	//		let out = 'storage/video.m3u8';
	//		streamTranscoder.outputOptions( [
	//			'-hls_time 10', // each .ts file has a length of 3 seconds
	//			'-hls_list_size 0', // each .ts file has a length of 3 seconds
	//			'-hls_base_url http://192.168.0.4:3000/segments/', // each .ts file has a length of 3 seconds
	//			//'-hls_segment_filename 0', // store all pieces in the .m3u8 file
	//			'-bsf:v h264_mp4toannexb' // ffmpeg aborts trasncoding in some cases without this
	//		] ).output( out ).run();
	//
	//		yield new Promise( ( resolve, reject ) => {
	//			streamTranscoder.on( 'progress', function ( progress ) {
	//				//console.log( progress.progress || progress );
	//				resolve();
	//			} );
	//		} );
	//
	//		streamTranscoder.on( 'finish', function ( progress ) {
	//			console.log( 'finish' );
	//		} );
	//
	//		//streamTranscoder.format( 'hls' );
	//		//streamTranscoder.custom( 'hls_time', '3' );
	//		//streamTranscoder.custom( 'hls_segment_filename', 'file%03d.ts' );
	//		//streamTranscoder.custom( 'bsf:v', 'h264_mp4toannexb' );
	//		//streamTranscoder.stream().pipe( fs.createWriteStream( out ) );
	//
	//		console.log( 'yeahhhhhhh' );
	//		fs.createReadStream( 'storage/video.m3u8', 'utf8' ).on( 'data', c => console.log( c ) ).on( 'error', (e) => console.error( 'error', e ) );
	//
	//		return fs.createReadStream( 'storage/video2.m3u8' );
	//	}.bind( this ) );
}