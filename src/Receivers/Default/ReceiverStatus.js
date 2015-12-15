import { EventEmitter } from 'events';

export default class ReceiverStatus extends EventEmitter {
	constructor ( receiver ) {
		super();

		this.receiver = receiver;

		this.changedAsync();
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
		return this.receiver.getStatus().then( status => {
			this.emit( 'update', status );

			this.setNextUpdate( status );

			return status;
		} );
	}

	changedAsync () {
		setTimeout( () => {
			this.changed();
		}, 1000 );
	}
}