export default class Controller {
	static routes () {

	}

	static action ( name, output = 'json' ) {
		let ControllerClass = this;
		return function * ( next ) {
			let controller = new ControllerClass( this );

			controller.ctx = this;
			controller.request = this.request;
			controller.response = this.response;
			controller.params = this.params;
			controller.server = this.server;

			let result = yield Promise.resolve( controller[ name ]( next ) );

			if ( output === 'raw' ) {
				this.body = result;
			} else if ( output === 'json' ) {
				this.response.set( 'Content-Type', 'application/json' );

				this.body = JSON.stringify( result );
			}
		};
	}

	constructor ( ctx ) {
		this.ctx = ctx;
		this.request = ctx.request;
		this.response = ctx.response;
	}


}
