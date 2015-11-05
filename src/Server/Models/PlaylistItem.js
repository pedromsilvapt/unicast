import Document from './Document';
import Playlist from './Playlist';
import PlaylistItemStatus from './PlaylistItemStatus';

export default class PlaylistItem extends Document {
	constructor() {
		super( 'playlist_items' );

		this.playlist = Playlist;
		this.type = String;
		this.source = String;
		this.subtitles = String;
		this.title = String;
		this.cover = String;
		this.order = Number;
		this.status = PlaylistItemStatus;
		this.data = Object;
		this.addedAt = {
			type: Date,
			'default': Date.now
		};
	}

	static maxOrder ( playlist ) {
		return playlist.items.reduce( ( memo, item ) => ( item && item.order >= memo ) ? item.order + 1 : memo, 0 );
	}
}