import co from 'co';
import config from 'config';
import Device from './ChromecastDevice';

export default class DevicesManager {
	constructor () {
		this.loaded = false;
		this.scanned = false;
		this.devices = {};
	}

	load () {
		return co( function * () {
			if ( config.has( 'devices.custom' ) ) {
				let custom = config.get( 'devices.custom' );

				for ( let device of custom ) {
					this.devices[ device.name ] = new Device( device.name, device.address );
				}

				this.loaded = true;
			}

			if ( !config.has( 'devices.scan' ) || config.get( 'devices.scan' ) ) {
				// TODO scan devices
				this.scanned = true;
			}
		}.bind( this ) );
	}

	get ( name ) {
		return co( function * () {
			if ( !this.loaded ) {
				yield this.load();
			}

			if ( !( name in this.devices ) ) {
				throw new Error( 'No device found with the name "' + name + '".' );
			}

			return this.devices[ name ];
		}.bind( this ) );
	}

	static getInstance () {
		if ( !this.instance ) {
			this.instance = new this();
		}

		return this.instance;
	}

	static get ( name ) {
		return this.getInstance().get( name );
	}
}