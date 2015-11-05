import path from 'path';
import co from 'co';
import fs from 'fs-promise';
import promisify from 'es6-promisify';
import parser from 'subtitles-parser';

export default class SubtitlesStream {
	constructor ( filepath ) {
		this.filepath = filepath;
	}

	isSRT ( file ) {
		return path.extname( file ).toLowerCase() === '.srt';
	}

	convert ( data ) {
		let subtitles = parser.fromSrt( data );

		let result = 'WEBVTT\n\n';

		for ( let line of subtitles ) {
			line.startTime = line.startTime.replace( /\,/g, '.' );
			line.endTime = line.endTime.replace( /\,/g, '.' );

			result += line.startTime + ' --> ' + line.endTime + '\n';
			result += line.text + '\n\n';
		}

		return result;
	}

	getVTT () {
		return co( function * () {
			let subtitles = yield fs.readFile( this.filepath );

			if ( !this.isSRT( this.filepath ) ) {
				return subtitles;
			}

			return this.convert( subtitles.toString( 'utf-8' ) );
		}.bind( this ) );
    }

	serve ( request, response ) {
		return co( function * () {
			let data = yield this.getVTT();

			response.status = 200;
			response.set( 'Access-Control-Allow-Origin', '*' );
			response.set( 'Content-Length', data.length );
			response.set( 'Content-type', 'text/vtt;charset=utf-8' );

			return data;
		}.bind( this ) );
	}
}