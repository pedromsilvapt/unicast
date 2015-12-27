import SubtitlesStream from '../Local/SubtitlesStream';
import SubtitlesDownloader from './SubtitlesDownloader';
import { promise as retry } from 'rerun';
import fs from 'fs-promise';

export default class YoutubeSubtitlesStream extends SubtitlesStream {
	constructor ( filepath ) {
		super( filepath );

		this.captions = new SubtitlesDownloader();
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

	async get () {
		let contents = await this.download( this.filepath );

		if ( !contents ) {
			contents = 'WEBVTT';
		}

		return this.convert( contents );
    }
}