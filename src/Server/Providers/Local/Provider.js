import PlaylistItem from '../../Models/PlaylistItem';
import Provider from '../Provider';
import fs from 'fs-promise';
import path from 'path';
import co from 'co';
import is from 'is';

import LocalVideoStream from './VideoStream';
import LocalSubtitlesStream from './SubtitlesStream';

export default class LocalProvider extends Provider {
	get identity () {
		return 'local';
	}

	identify ( source ) {
		return true;
	}

	async itemSubtitles ( source, subtitles = null ) {
		if ( !subtitles ) {
			subtitles = path.join( path.dirname( source ), path.basename( source, path.extname( source ) ) + '.srt' );

			if ( !( await fs.exists( subtitles ) ) ) {
				subtitles = null;
			}
		}

		if ( !subtitles ) {
			let stream = this.video( source );

			let metadata = await stream.embedded.subtitles( 'por' );

			if ( metadata.length ) {
				subtitles = metadata[ 0 ];
			}
		}

		return subtitles;
	}

	async item ( playlist, request ) {
		let source = request.body.source;

		let subtitles = await this.itemSubtitles( source, request.body.subtitles );
		if ( is.object( subtitles ) ) {
			subtitles = 'embed://subtitles/' + subtitles.index;
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
	}

	video ( source ) {
		return new LocalVideoStream( source );
	}

	subtitles ( source ) {
		return new LocalSubtitlesStream( source );
	}
}