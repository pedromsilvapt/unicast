import is from 'is';
import ItemsFactory from './Factories/ItemsFactory';
import VideoStreamsFactory from './Factories/VideosFactory';
import SubtitlesStreamsFactory from './Factories/SubtitlesFactory';

export default class Manager {
	constructor () {
		this.providers = {};
		this.identifiers = [];
		this.defaultProvider = null;

		this.items = new ItemsFactory();
		this.videos = new VideoStreamsFactory();
		this.subtitles = new SubtitlesStreamsFactory();
	}

	register ( provider ) {
		this.providers[ provider.identity ] = provider;

		provider.register( this );

		return this;
	}

	get defaultProviderName () {
		if ( is.object( this.defaultProvider ) ) {
			return this.defaultProvider.identity;
		}

		return this.defaultProvider;
	}

	identify ( source, type = null ) {
		let result;

		for ( let identifier of this.identifiers ) {
			result = identifier( source, type );

			if ( !is.undef( result ) ) {
				break;
			}
		}

		if ( is.undef( result ) ) {
			result = this.defaultProviderName;
		}

		return result;
	}

	item ( source, playlist, request ) {
		let identity = this.identify( source );

		return Promise.resolve( this.items.make( identity, playlist, request ) );
	}

	video ( source, media, receiver = null ) {
		let identity = this.identify( source, 'video' );

		return this.videos.make( identity, source, media, receiver );
	}

	subtitle ( source, media, receiver = null ) {
		let identity = this.identify( source, 'subtitles' );

		return this.subtitles.make( identity, source, media, receiver );
	}
}