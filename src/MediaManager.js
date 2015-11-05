import PlaylistItem from './Server/Models/PlaylistItem';
import Dictionary from './Server/Utilities/Dictionary';
import MediaFactory from './MediaFactory';
import internalIp from 'internal-ip';
import guid from 'guid';
import co from 'co';

export default class MediaManager {
	constructor () {
		this.devices = new Map();
		this.mediaFactory = new MediaFactory();
	}

	has ( id ) {
		return PlaylistItem.count( { _id: id } ).then( c => c > 0 );
	}

	get ( id ) {
		return PlaylistItem.loadOne( { _id: id } );
	}

	makeMessage ( id, data, server ) {
		return this.mediaFactory.make( data.type, data, server );
	}

	make ( media, server, device ) {
		media = this.makeMessage( media.id, media, server );

		media.subtitles_style = device.getSubtitlesStyle();

		return media;
	}

	store ( data ) {
		return co( function * () {
			let item = PlaylistItem.create( data );

			item = yield item.save();

			return item;
		}.bind( this ) );
	}

	play ( media, device, server, reset = false ) {
		return co( function * () {
			if ( reset ) {
				media.status.reset();

				yield media.save();
			}

			if ( device.current && device.current.status ) {
				yield device.current.status.stop( device.current );
			}

			let message = this.make( media, server, device );

			yield device.play( message, media.status ? media.status.currentTime : 0 );

			device.current = media;

			this.setup( device );

			return message;
		}.bind( this ) );
	}

	stop ( device ) {
		return co( function * () {
			if ( device.current ) {
				let playlist = Playlist.loadOne( { device: device.name, current: device.current.id } );

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