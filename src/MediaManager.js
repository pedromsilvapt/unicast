import PlaylistItem from './Server/Models/PlaylistItem';
import Dictionary from './Server/Utilities/Dictionary';
import co from 'co';

export default class MediaManager {
	constructor ( server ) {
		this.server = server;

		this.devices = {
			senders: new Map(),
			status: new Map()
		};
	}

	has ( id ) {
		return PlaylistItem.count( { _id: id } ).then( c => c > 0 );
	}

	get ( id ) {
		return PlaylistItem.loadOne( { _id: id } );
	}

	async store ( data ) {
		let item = PlaylistItem.create( data );

		item = await item.save();

		return item;
	}

	async play ( media, receiver, reset = false ) {
		if ( reset ) {
			media.status.reset();

			await media.save();
		}

		let sender = this.server.providers.video( media.source, media, receiver );

		await this.listen( receiver );

		let message = await receiver.play( media, this.server, sender );

		await this.setup( receiver );

		return message;
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

	async listen ( receiver ) {
		if ( !this.devices.senders.has( receiver ) ) {
			let router = this.server.senders.register( receiver );

			this.devices.senders.set( receiver, router );

			return router;
		}

		return this.devices.senders.get( receiver );
	}

	async setup ( receiver ) {
		if ( this.devices.status.has( receiver ) ) {
			return;
		}

		this.devices.status.set( receiver, true );

		receiver.status.on( 'update', this.update.bind( this, receiver ) );
	}

	async update ( device, status ) {
		if ( device.current ) {
			await device.current.status.update( device.current, status );

			console.log( device.current.status.state, device.current.status.percentage, device.current.status.currentTime, device.current.status.duration );
		}
	}

	static getInstance () {
		if ( !this.instance ) {
			this.instance = new this();
		}

		return this.instance;
	}
}