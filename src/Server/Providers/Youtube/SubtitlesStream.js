import SubtitlesStream from '../Local/SubtitlesStream';
import YoutubeCaptions from './YoutubeCaptions';
import { promise as retry } from 'rerun';
import fs from 'fs-promise';
import co from 'co';

export default class YoutubeSubtitlesStream extends SubtitlesStream {
	constructor ( filepath ) {
		super( filepath );

		this.captions = new YoutubeCaptions();
	}

	download ( filepath ) {
		return retry( () => {
			return this.captions.download( filepath, {
				language: 'pt',
				allowAutomaticCaptions: true
			} ) ;
		}, {
			retries: 5,
			retryTimeout: 500,
			retryFactor: 2
		} ).catch( ( error ) => { console.error( 'Subtitles', error.message, error.stack );  return null } );
	}

	getVTT () {
		return co( function * () {
			let contents = yield this.download( this.filepath );

			if ( !contents ) {
				contents = 'WEBVTT';
			}

			return this.convert( contents );
		}.bind( this ) );
    }
}