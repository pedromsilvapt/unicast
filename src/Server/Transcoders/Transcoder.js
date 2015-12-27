import StreamTranscoder from 'stream-transcoder';
import TranscodingProcess from './Process';
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

	run ( stream, metadata, force = false ) {
		let streamTranscoder = new StreamTranscoder( stream );

		if ( force || !this.matches( metadata ) ) {
			return stream;
		}

		streamTranscoder = this.codec.convert( streamTranscoder, metadata );

		let transcodingProcess = new TranscodingProcess( streamTranscoder );

		return transcodingProcess.start();
	}
}