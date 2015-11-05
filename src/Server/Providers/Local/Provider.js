import Provider from '../Provider';
import PlaylistItem from '../../Models/PlaylistItem';
import fs from 'fs-promise';
import path from 'path';
import co from 'co';

import LocalVideoStream from './VideoStream';
import LocalSubtitlesStream from './SubtitlesStream';

export default class LocalProvider extends Provider {
	get identity () {
		return 'local';
	}

	identify ( source ) {
		return true;
	}

	item ( playlist, request ) {
		return co( function * () {
			let source = request.body.source;

			let subtitles = request.body.subtitles;
			if ( !subtitles ) {
				subtitles = path.join( path.dirname( source ), path.basename( source, path.extname( source ) ) + '.srt' );

				if ( !( yield fs.exists( subtitles ) ) ) {
					subtitles = null;
				}
			}

			return {
				type: request.body.type,
				source: source,
				subtitles: subtitles,
				title: request.body.title,
				cover: request.body.cover,
				order: PlaylistItem.maxOrder( playlist ),
				data: request.body.data || {}
			};
		}.bind( this ) );
	}

	video ( source ) {
		return new LocalVideoStream( source );
	}

	subtitles ( source ) {
		return new LocalSubtitlesStream( source );
	}
}