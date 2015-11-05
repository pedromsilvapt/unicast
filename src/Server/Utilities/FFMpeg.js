import probe from 'node-ffprobe';
import promisify from 'es6-promisify';

export default class FFMpeg {
	static probe ( track ) {
		return promisify( probe )( track );
	}
}