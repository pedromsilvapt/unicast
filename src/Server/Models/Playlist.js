import PlaylistItem from './PlaylistItem';
import Document from './Document';
import sortBy from 'sort-by';
import co from 'co';

export default class Playlist extends Document {
	constructor () {
		super( 'playlists' );

		this.device = String;
		this.items = [PlaylistItem];
		this.current = PlaylistItem;
		this.addedAt = {
			type: Date,
			'default': Date.now
		};
	}

	static followingItems ( filter, sorter, query, length = null ) {
		return co( function * () {
			let playlist = yield this.loadOne( query );

			let current = playlist.current;

			let nextItems = playlist.items.filter( i => filter( i, current ) ).sort( sorter );

			if ( length !== null ) {
				nextItems = nextItems.slice( 0, length );
			}

			return nextItems;
		}.bind( this ) );
	}

	static previousItems ( query, length = null ) {
		return this.followingItems( ( i, current ) => i && ( !current || i.order < current.order ),sortBy( '-order' ), query, length );
	}

	static nextItems ( query, length = null ) {
		return this.followingItems( ( i, current ) => i && ( !current || i.order > current.order ),sortBy( 'order' ), query, length );
	}

	preValidate () {
		this.items = this.items.filter( i => i );
	}

	remove ( item, index = null ) {
		return co( function * () {
			let playlist = this;

			if ( is.number( item ) ) {
				index = item;

				item = this.items[ index ];
			}

			if ( !item ) {
				return;
			}

			if ( this.current == item ) {
				this.current = null;

				playlist = yield this.save();
			} else if ( item ) {
				yield item.delete();
			}

			if ( index === null ) {
				index = this.items.indexOf( item );
			}

			if ( index >= 0 ) {
				this.items[ index ] = null;
			}

			return playlist;
		}.bind( this ) );
	}

	clear () {
		return co( function * () {
			let playlist = this;

			for ( let [ index, item ] of ( this.items || [] ).entries() ) {
				playlist = yield this.remove( item, index );
			}

			return playlist;
		}.bind( this ) );
	}
}