import { exec, spawn } from 'child_process';
import StayAwake from './StayAwake';
import config from 'config';
import extend from 'extend';
import is from 'is';

export default class Command extends StayAwake {
	constructor () {
		super();

		this.ranOnce = false;
	}

	runCommand ( command ) {
		return new Promise( ( resolve, reject ) => {
			try {
				if ( is.string( command ) ) {
					command = { cmd: command };
				}

				if ( is.string( command.args ) ) {
					command.args = [ command.args ];
				}

				let defaultCommand = {};
				if ( config.has( 'stayAwake.command.default' ) ) {
					 defaultCommand = config.get( 'stayAwake.command.default' );
				}

				command = extend( true, { args: [], options: {
					detached: true,
					stdio: 'ignore',
					wait: true
				} }, defaultCommand, command );

				//return exec( command.cmd + ' ' + command.args.join( ' ' ), command.options, ( error, stdout, stderr ) => {
				//	if ( error ) {
				//		return reject( error );
				//	}
				//
				//	resolve( stdout.toString( 'utf8' ) );
				//} );

				let child = spawn( command.cmd, command.args, command.options );
				child.on( 'error', e => reject( e ) );
				child.on( 'close', e => resolve() );
				child.on( 'exit', e => resolve() );
				child.on( 'disconnect', e => resolve() );

				child.unref();

				if ( !command.wait ) {
					resolve();
				}
			} catch ( error ) {
				reject( error );
			}
		} );
	}

	async runCommandNamed ( name, optional ) {
		if ( !optional || config.has( 'stayAwake.command.' + name ) ) {
			let command = extend( {}, config.get( 'stayAwake.command.' + name ) );

			return this.runCommand( command );
		}
	}

	async start () {
		await this.runCommandNamed( 'startup', true );
	}

	async turnOn () {
		if ( !this.ranOnce ) {
			await this.start();
		}

		await this.runCommandNamed( 'activate' );
	}

	async turnOff () {
		await this.runCommandNamed( 'deactivate' );
	}

}