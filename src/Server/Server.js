import koa from 'koa';
import router from 'koa-router';
import body from 'koa-body';
import internalIp from 'internal-ip';

export default class Server {
	constructor () {
		this.app = koa();
		this.router = this.makeRouter();

		this.ports = [];
	}

	get ip () {
		return internalIp();
	}

	get port () {
		return this.ports[ 0 ] || null;
	}

	url ( segments = [] ) {
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

	makeRouter ( options ) {
		return router( options );
	}

	controller ( controller ) {
		controller.routes( this.router, this.makeRouter.bind( this ) );
	}

	async initialize () {
		let server = this;

		this.use( body() );

		this.use( function * ( next ) {
			this.response.set( 'Access-Control-Allow-Origin', '*' );
			this.response.set( 'Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS' );

			this.response.set( 'Cache-Control', 'no-cache, no-store, must-revalidate' );
			this.response.set( 'Pragma', 'no-cache' );
			this.response.set( 'Expires', '0' );

			yield next;
		} );

		this.use( function * ( next ) {
			this.server = server;

			yield next;
		} );

		this.useRoutes();
	}

	async listen ( port = null ) {
		await this.initialize();

		this.app.listen( port );

		this.ports.push( port );

		return {
			ip: this.ip,
			port: port
		};
	}
}