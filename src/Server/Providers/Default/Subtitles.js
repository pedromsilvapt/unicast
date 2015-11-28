import srt2vtt  from 'srt-to-vtt';

export default class Subtitles {
	constructor ( source ) {
		this.source = source;
	}

	convert () {
		return this.source.pipe( srt2vtt() );
	}
}