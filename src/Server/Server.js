import co from 'co';
import koa from 'koa';
import config from 'config';
import router from 'koa-router';
import body from 'koa-body';
import { connect } from 'camo';
import internalIp from 'internal-ip';
import ProvidersManager from './Providers/Manager';
import ReceiversManager from '../Receivers/Manager';

import { Logger } from './Logger';

export default class Server {
	constructor () {
		this.app = koa();
		this.router = this.makeRouter();

		this.providers = new ProvidersManager();
		this.receivers = new ReceiversManager();

		this.ports = [];
	}

	get ip () {
		return internalIp();
	}

	get port () {
		return this.ports[ 0 ] || null;
	}

	url ( segments ) {
		let serverUrl = 'http://' + this.ip + ':' + this.port;

		let part = segments.filter( s => s ).join( '/' );

		if ( part ) {
			serverUrl += '/' + part;
		}

		return serverUrl;
	}

	use ( middleware ) {
		this.app.use( middleware );

		return this;
	}

	useRoutes () {
		return this.use( this.router.routes() )
			.use( this.router.allowedMethods() );
	}

	makeRouter () {
		return router();
	}

	controller ( controller ) {
		controller.routes( this.router, this.makeRouter.bind( this ) );
	}

	initialize () {
		return co( function * () {
			let server = this;

			this.use( Logger.koa() );
			this.app.on( 'error', Logger.koaError() );

			this.use( function * ( next ) {
				this.server = server;

				yield next;
			} );

			this.use( function * ( next ) {
				this.response.set( 'Access-Control-Allow-Origin', '*' );
				this.response.set( 'Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS' );

				yield next;
			} );

			this.use( body() );

			this.useRoutes();
		}.bind( this ) );
	}

	listen ( port = null ) {
		return co( function * () {
			if ( !port ) {
				port = config.get( 'server.port' );
			}

			this.database = yield connect( 'nedb://storage/database' );

			yield this.initialize();

			this.app.listen( port );

			this.ports.push( port );

			return {
				ip: this.ip,
				port: port
			};
		}.bind( this ) );
	}
}