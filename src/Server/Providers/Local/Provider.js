import PlaylistItem from '../../Models/PlaylistItem';
import Provider from '../Provider';
import TranscodersManager from '../../Transcoders/Manager';
import config from 'config';
import fs from 'fs-promise';
import path from 'path';
import is from 'is';

import LocalVideoStream from './VideoStream';
import LocalSubtitlesStream from './SubtitlesStream';
import LocalEmbeddedSubtitlesStream from './EmbeddedSubtitlesStream';

export default class LocalProvider extends Provider {
	constructor () {
		super();

		this.transcodingProcesses = new TranscodersManager();
	}

	get identity () {
		return 'local';
	}

	identify ( source, type ) {
		if ( type == 'subtitles' ) {
			if ( source.startsWith( 'embed://' ) ) {
				return this.identity + '-embed';
			}
		}

		return true;
	}

	async itemEmbeddedSubtitles ( source, language = null ) {
		let stream = this.video( source );

		if ( !language && config.has( 'providers.local.subtitles.defaultLanguage' ) ) {
			language = config.get( 'providers.local.subtitles.defaultLanguage' );
		}

		let metadata = await stream.embedded.subtitles( language );

		if ( metadata.length ) {
			return metadata[ 0 ];
		}

		return null;
	}

	async itemSubtitles ( source, subtitles = null ) {
		if ( !subtitles ) {
			subtitles = path.join( path.dirname( source ), path.basename( source, path.extname( source ) ) + '.srt' );

			if ( !( await fs.exists( subtitles ) ) ) {
				subtitles = null;
			}
		}

		if ( !subtitles ) {
			subtitles = await this.itemEmbeddedSubtitles( source );
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
			order: PlaylistItem.maxOrder( playlist ) || 0,
			data: request.body.data || {}
		};
	}

	video ( source, media, receiver ) {
		return new LocalVideoStream( source, receiver );
	}

	subtitlesExternal ( source ) {
		return new LocalSubtitlesStream( source );
	}

	subtitlesEmbedded ( source, media ) {
		return new LocalEmbeddedSubtitlesStream( this.video( media.source ), source );
	}

	register ( manager ) {
		super.register( manager );

		manager.subtitles.define( this.identity, this.subtitlesExternal.bind( this ) );

		manager.subtitles.define( this.identity + '-embed', this.subtitlesEmbedded.bind( this ) );
	}
}