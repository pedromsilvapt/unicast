import path from 'path';
import fs from 'fs-promise';
import promisify from 'es6-promisify';
import parser from 'subtitles-parser';
import SubtitlesStream from './SubtitlesStream';
import Subtitles from '../Default/Subtitles';
import strToStr from 'string-to-stream';
import url from 'url';

export default class EmbededSubtitlesStream extends SubtitlesStream {
	constructor ( movie, options ) {
		super();

		this.movie = movie;
		this.options = options;
	}

	track ( identifier, subtitles ) {
		let parsed = url.parse( identifier );

		let segments = parsed.pathname.split( '/' ).filter( s => s );

		if ( segments.length == 0 ) {
			return null;
		}

		let index = +segments[ 0 ];

		if ( index < 0 || index >= subtitles.length ) {
			return null;
		}

		return subtitles[ index ];
	}

	async get () {
		let subtitles = await this.movie.embedded.subtitles();

		let track = this.track( this.options, subtitles );

		if ( track ) {
			subtitles = new Subtitles( track.extract() );
		} else {
			subtitles = new Subtitles( strToStr( '' ) );
		}

		return subtitles.convert( subtitles );
    }
}