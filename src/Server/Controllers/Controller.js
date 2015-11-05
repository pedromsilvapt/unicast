export default class Controller {
	static routes () {

	}

	static action ( name, output = 'json' ) {
		let ControllerClass = this;
		return function * ( next ) {
			let controller = new ControllerClass( this );

			this.controller = controller;

			let result = yield controller[ name ].bind( this )( next );

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
