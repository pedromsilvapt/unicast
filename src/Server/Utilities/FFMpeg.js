import probe from 'node-ffprobe';
import ffmpeg from 'fluent-ffmpeg';
import promisify from 'es6-promisify';

export default class FFMpeg {
	static probe ( track ) {
		return promisify( probe )( track );
	}

	static open ( ...args ) {
		return ffmpeg( ...args );
	}
}