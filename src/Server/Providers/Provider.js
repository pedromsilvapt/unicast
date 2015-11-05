import is from 'is';

export default class Provider {
	register ( manager ) {
		if ( is.fn( this.identify ) ) {
			manager.identifiers.push( ( source, type ) => {
				let identity = this.identify( source, type );

				if ( identity === true ) {
					identity = this.identity;
				}

				if ( identity ) {
					return identity;
				}
			} );
		}

		if ( is.fn( this.item ) ) {
			manager.items.define( this.identity, this.item.bind( this ) );
		}

		if ( is.fn( this.video ) ) {
			manager.videos.define( this.identity, this.video.bind( this ) );
		}

		if ( is.fn( this.subtitles ) ) {
			manager.subtitles.define( this.identity, this.subtitles.bind( this ) );
		}
	}
}