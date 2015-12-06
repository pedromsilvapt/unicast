import promisify from 'es6-promisify';
import scribe from 'scribe-js';
import bunyan from 'bunyan';
import config from 'config';

export class LoggerService {
	constructor ( name ) {
		this.name = name;
		//this.bunyan = bunyan.createLogger( { name: name } );
		this.scribe = scribe();


		this.defaultTags = [];

		this.addTag( { msg: this.name, colors: 'cyan' } );
	}

	get console () {
		return process.console;
	}

	time ( ...args ) {
		return this.console.time( ...args );
	}

	addTag ( tag ) {
		this.defaultTags.push( tag );
	}

	tag ( ...args ) {
		return this.console.tag( ...args );
	}

	info ( ...args ) {
		return this.console.info( ...args );
	}

	warning ( ...args ) {
		return this.console.warning( ...args );
	}

	log ( ...args ) {
		return this.console.log( ...args );
	}

	error ( ...args ) {
		return this.console.error( ...args );
	}

	message ( ...messages ) {
		return this.time().tag( ...this.defaultTags ).log( ...messages );
	}

	koa ( validate = null ) {
		let logger = this;
		let Console2 = this.scribe.Console2;

		let console = process.console;

		if ( console.info === undefined ) {
			throw new Error( 'No \'info\' logger attach to console' );
		}

		return function * ( next ) {
			if ( !validate || validate( this.request, this.response ) ) {
				console
					.time()
					.tag(
						...logger.defaultTags,
						{ msg: this.request.ip, colors: 'red' },
						{ msg: this.request.method.toUpperCase(), colors: 'green' },
						{
							msg: (/mobile/i.test( this.request.get( 'user-agent' ) ) ? 'MOBILE' : 'DESKTOP'),
							colors: 'grey'
						}
					).info( this.request.url );
			}

			yield next;
		}
	}

	koaError () {
		return function ( err ) {
			this.tag(
				{ msg: this.name, colors: 'cyan' }
			).error( err.message, err.stack );
		}.bind( this );
	}
}

var Logger = new LoggerService( config.get( 'name' ) );

export default Logger;