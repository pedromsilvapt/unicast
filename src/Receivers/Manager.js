import config from 'config';
import co from 'co';
import is from 'is';

export default class Manager {
	constructor ( server ) {
		this.types = {};

		this.server = server;
	}

	async load ( Receiver ) {
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
	}

	async listen ( Receiver ) {
		let receiver = this.getType( Receiver );

		if ( is.string( Receiver ) ) {
			Receiver = receiver.constructor;
		}

		await Promise.resolve( Receiver.senders.listen() );
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

	all () {
		return Object.keys( this.types ).map( key => this.types[ key ] );
	}

	async get ( name, type ) {
		let types;

		if ( !type ) {
			types = this.all();
		} else {
			types = [ this.getType( type ) ];
		}

		for ( let receiver of types ) {
			if ( !receiver.loaded ) {
				await this.load( receiver.type );
			}

			if ( name in receiver.devices ) {
				return receiver.devices[ name ];
			}
		}

		throw new Error( 'No device found with the name "' + name + '".' );
	}
}