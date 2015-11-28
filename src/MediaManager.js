import PlaylistItem from './Server/Models/PlaylistItem';
import Dictionary from './Server/Utilities/Dictionary';
import co from 'co';

export default class MediaManager {
	constructor () {
		this.devices = new Map();
	}

	has ( id ) {
		return PlaylistItem.count( { _id: id } ).then( c => c > 0 );
	}

	get ( id ) {
		return PlaylistItem.loadOne( { _id: id } );
	}

	make ( media, server, device ) {
		media = this.makeMessage( media.id, media, server );

		media.subtitles_style = device.getSubtitlesStyle();

		return media;
	}

	async store ( data ) {
		let item = PlaylistItem.create( data );

		item = await item.save();

		return item;
	}

	play ( media, device, server, reset = false ) {
		return co( function * () {
			if ( reset ) {
				media.status.reset();

				yield media.save();
			}

			let sender = server.providers.video( media.source, media );

			let message = yield device.play( media, server, sender );

			this.setup( device );

			return message;
		}.bind( this ) );
	}

	stop ( device ) {
		return co( function * () {
			if ( device.current ) {
				let playlist = yield device.playlist;

				if ( playlist ) {
					playlist.current = null;

					yield playlist.save();
				}
			}

			device.stop();
		}.bind( this ) );
	}

	setup ( device ) {
		if ( this.devices.has( device ) ) {
			return;
		}

		this.devices.set( device, true );

		device.status.on( 'update', this.update.bind( this, device ) );
	}

	update ( device, status ) {
		return co( function * () {
			if ( device.current ) {
				yield device.current.status.update( device.current, status );

				console.log( device.current.status.state, device.current.status.percentage, device.current.status.currentTime, device.current.status.duration );
			}
		}.bind( this ) );
	}

	static getInstance () {
		if ( !this.instance ) {
			this.instance = new this();
		}

		return this.instance;
	}
}