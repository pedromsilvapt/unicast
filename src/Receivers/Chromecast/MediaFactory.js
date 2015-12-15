import Factory from '../../Server/Utilities/Factory';
import extend from 'extend';
import is from 'is';

export default class MediaFactory extends Factory {
	constructor () {
		super();

		this.define( 'generic', this.makeGenericRequest.bind( this ) );
		this.define( 'movie', this.makeMovieRequest.bind( this ) );
		this.define( 'show', this.makeShowRequest.bind( this ) );
	}

	makeDefaultMedia ( media, server, receiver, custom = {} ) {
		let sender = server.sender( receiver );
		let urlParams = {
			receiver: receiver.name,
			media: media.id
		};

		let message = {
			contentId: sender.url( 'video', urlParams ),
			contentType: 'video/mp4',
			tracks: null,
			metadata: {
				type: 0,
				metadataType: 0,
				itemId: media.id,
				title: media.title,
				images: [
					{ url: media.cover }
				]
			}
		};

		if ( media.subtitles ) {
			if ( !is.array( media.subtitles ) ) {
				media.subtitles = [ media.subtitles ];
			}

			let tracks = [];
			for ( let [ index, subtitles ] of media.subtitles.entries() ) {
				if ( is.string( subtitles ) ) {
					subtitles = {
						source: subtitles
					};
				}

				tracks.push( {
					trackId: subtitles.id || index,
					type: 'TEXT',
					trackContentId: sender.url( 'subtitles', urlParams ),
					trackContentType: subtitles.type || 'text/vtt',
					name: subtitles.name || 'Português',
					language: subtitles.language || 'pt-PT',
					subtype: 'SUBTITLES'
				} );
			}

			if ( tracks.length > 0 ) {
				message.tracks = tracks;
			}
		}

		return extend( true, message, custom );
	}

	makeGenericRequest ( media, server, receiver, custom = {} ) {
		return this.makeDefaultMedia( media, server, receiver, extend( true, {
			metadata: {
				metadataType: 0
			}
		}, custom ) );
	}

	makeMovieRequest ( media, server, receiver, custom = {} ) {
		return this.makeDefaultMedia( media, server, receiver, extend( true, {
			metadata: {
				metadataType: 1,
				releaseDate: '2015-05-06'
			}
		}, custom ) );
	}

	makeShowRequest ( media, server, receiver, custom = {} ) {
		return this.makeDefaultMedia( media, server, receiver, extend( true, {
			metadata: {
				metadataType: 2,
				seriesTitle: media.data.showTitle,
				episode: media.data.episode,
				season: media.data.season
			}
		}, custom ) );
	}

	make ( media = null, ...options ) {
		return super.make( media.type, media, ...options );
	}
}