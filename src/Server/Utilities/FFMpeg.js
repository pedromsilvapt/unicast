import probe from 'node-ffprobe';
import ffmpeg from 'fluent-ffmpeg';
import promisify from 'es6-promisify';

export default class FFMpeg {
	static probe ( track ) {
		return promisify( probe )( track ).then( metadata => {
			metadata.streams = metadata.streams.map( ( s, i ) => {
				s.index = i;

				return s;
			} );

			return metadata;
		} );
	}

	static open ( ...args ) {
		return ffmpeg( ...args );
	}
}