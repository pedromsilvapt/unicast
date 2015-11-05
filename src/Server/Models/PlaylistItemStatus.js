import PlaylistItem from './PlaylistItem';
import EmbeddedDocument from './EmbeddedDocument.js';

export default class PlaylistItemStatus extends EmbeddedDocument {
	constructor () {
		super();

		this.state = {
			type: String,
			'default': 'STOPPED'
		};
		this.currentTime = {
			type: Number,
			'default': 0
		};
		this.duration = {
			type: Number,
			'default': 0
		};
	}

	get percentage () {
		if ( !this.duration || !this.currentTime ) {
			return 0;
		}

		return Math.round( this.currentTime * 100 / this.duration * 100 ) / 100;
	}

	update ( item, status ) {
		if ( !status || item.id !== status.media.metadata.itemId ) {
			this.state = 'STOPPED';
		} else if ( status.playerState == 'PAUSED' || status.playerState == 'PLAYING' ) {
			this.state = status.playerState;

			if ( status ) {
				this.currentTime = status.currentTime;
				this.duration = status.media.duration;
			}
		}


		if ( this.state == 'STOPPED' ) {
			if ( this.percentage < 5 || this.percentage > 95  ) {
				this.currentTime = 0;
			}
		}

		return item.save();
	}

	stop ( item ) {
		return this.update( item, null );
	}

	reset () {
		this.state = 'STOPPED';
		this.currentTime = 0;
	}
}