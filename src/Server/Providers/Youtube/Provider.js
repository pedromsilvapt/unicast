import Provider from '../Provider';
import PlaylistItem from '../../Models/PlaylistItem';
import promisify from 'es6-promisify';
import ytdl from 'ytdl-core';
import li from 'link-id';
import co from 'co';

import YoutubeVideoStream from './VideoStream';
import YoutubeSubtitlesStream from './SubtitlesStream';

export default class YoutubeProvider extends Provider {
	get identity () {
		return 'youtube';
	}

	identify ( source ) {
		let info = li( source );

		if ( info && info.type === 'youtube' ) {
			return 'youtube';
		}
	}

	item ( playlist, request ) {
		return co( function * () {
			let source = request.body.source;

			let info = yield promisify( ytdl.getInfo.bind( ytdl ) )( source );

			return {
				type: 'generic',
				source: source,
				subtitles: source,
				title: info.title,
				cover: info.iurlmaxres,
				order: PlaylistItem.maxOrder( playlist ),
				data: request.body.data || {}
			};
		}.bind( this ) );
	}

	video ( source ) {
		return new YoutubeVideoStream( source );
	}

	subtitles ( source ) {
		return new YoutubeSubtitlesStream( source );
	}
}