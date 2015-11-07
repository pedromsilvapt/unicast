import config from 'config';
import co from 'co';
import is from 'is';

export default class Manager {
	constructor () {
		this.types = {};
	}

	load ( Receiver ) {
		return co( function * () {
			let receiver = this.getType( Receiver );

			if ( is.string( Receiver ) ) {
				Receiver = receiver.constructor;
			}

			if ( config.has( 'devices.custom' ) ) {
				let custom = config.get( 'devices.custom' );

				custom = custom.filter( device => device.type == Receiver.type );

				for ( let device of custom ) {
					this.registerDevice( new Receiver( device.name, device ) );
				}

				receiver.loaded = true;
			}

			if ( !config.has( 'devices.scan' ) || config.get( 'devices.scan' ) ) {
				// TODO scan devices
				receiver.scanned = true;
			}
		}.bind( this ) );
	}

	register ( receiver ) {
		this.types[ receiver.type ] = {
			type: receiver.type,
			constructor: receiver,
			devices: {}
		};
	}

	registerDevice ( receiver, type = null ) {
		type = this.getType( type || receiver );

		type.devices[ receiver.name ] = receiver;

		return this;
	}

	getType ( type ) {
		if ( is.object( type ) ) {
			type = type.type;
		}

		return this.types[ type ];
	}

	get ( type, name ) {
		return co( function * () {
			let receiver = this.getType( type );

			if ( !receiver.loaded ) {
				yield this.load( receiver.type );
			}

			if ( !( name in receiver.devices ) ) {
				throw new Error( 'No device found with the name "' + name + '".' );
			}

			return receiver.devices[ name ];
		}.bind( this ) );
	}
}