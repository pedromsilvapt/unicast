import Factory from './Server/Utilities/Factory';
import extend from 'extend';

export default class MediaFactory extends Factory {
	constructor () {
		super();

		this.define( 'generic', this.makeMovieTitle.bind( this ) );
		this.define( 'movie', this.makeMovieTitle.bind( this ) );
		this.define( 'show', this.makeShowTitle.bind( this ) );
	}

	makeDefaultMedia ( media, server, custom = {} ) {
		let serverUrl = 'http://' + server.ip + ':' + server.port;

		let subtitles = null;
		if ( media.subtitles ) {
			subtitles = [ {
				language: 'pt-PT',
				url: serverUrl + '/subtitles/' + media.id,
				name: 'Português'
			} ];
		}

		return {
			id: media.id,
			url : serverUrl + '/watch/' + media.id,
			subtitles: subtitles,
			metadata: extend(  {
				itemId: media.id,
				title: media.title,
				cover: media.cover
			}, custom )
		};
	}

	makeGenericMedia ( media, server ) {
		return this.makeDefaultMedia( media, server, {
			metadataType: 0,
			title: media.title
		} );
	}

	makeMovieTitle ( media, server ) {
		return this.makeDefaultMedia( media, server, {
			metadataType: 1,
			title: media.title,
			releaseDate: '2015-05-06'
		} );
	}

	makeShowTitle ( media, server ) {
		let pad = function pad( n, width, z ) {
			z = z || '0';
			n = n + '';
			return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
		};

		let title = media.data.showTitle + ' S' + pad( media.data.season, 2 ) + 'E' + pad( media.data.episode, 2 );

		return this.makeDefaultMedia( media, server, {
			metadataType: 2,
			title: media.title,
			seriesTitle: media.data.showTitle,
			episode: media.data.episode,
			season: media.data.season
		} );
	}
}