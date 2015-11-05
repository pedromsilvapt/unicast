import { EventEmitter } from 'events';

export default class DeviceStatus extends EventEmitter {
	constructor ( device ) {
		super();

		this.device = device;

		this.changed();
	}

	setNextUpdate ( status ) {
		if ( this.nextUpdate ) {
			clearTimeout( this.nextUpdate );
		}

		if ( !status ) {
			return;
		}

		if ( status.playerState == 'PAUSED' ) {
			return;
		}

		let delay = 10000;

		if ( status.media.duration - status.currentTime < ( 7 * 60 ) ) {
			delay = 5000;

			if ( status.media.duration - status.currentTime < 60 ) {
				delay = 1000;
			}
		}

		this.nextUpdate = setTimeout( () => {
			this.changed();
		}, delay );
	}

	changed () {
		return this.device.getStatus().then( status => {
			this.emit( 'update', status );

			this.setNextUpdate( status );

			return status;
		} );
	}
}