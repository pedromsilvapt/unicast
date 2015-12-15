import is from 'is';

export default class SendersManager {
	constructor ( server ) {
		this.server = server;
		this.prefix = '/receiver/:receiver/send/:media';

		this.methods = {};
		this.senders = new Map();
	}

	register ( receiver ) {
		let router = new SenderRouter( receiver, this );

		this.senders.set( receiver, router.sender );

		router.sender.register();

		return router;
	}

	get ( receiver ) {
		return this.senders.get( receiver );
	}

	getByMethod ( method ) {
		if ( !is.string( method ) ) {
			throw new Error( 'Expecting a string as method name' );
		}

		method = method.toLowerCase();

		if ( !( method in this.methods ) ) {
			this.methods[ method ] = new RoutesContainer( method, this );
		}

		return this.methods[ method ];
	}

	request ( receiver, method, route, handler ) {
		let routesContainer = this.getByMethod( method );

		return routesContainer.route( receiver, route, handler );
	}
}

export class SenderRouter {
	constructor ( receiver, manager ) {
		this.receiver = receiver;
		this.manager = manager;
		this.sender = receiver.createSender( this );
	}

	get ( route, handler ) {
		return this.manager.request( this.receiver, 'get', route, handler );
	}

	post ( route, handler ) {
		return this.manager.request( this.receiver, 'post', route, handler );
	}

	put ( route, handler ) {
		return this.manager.request( this.receiver, 'put', route, handler );
	}

	[ 'delete' ] ( route, handler ) {
		return this.manager.request( this.receiver, 'delete', route, handler );
	}

	patch ( route, handler ) {
		return this.manager.request( this.receiver, 'patch', route, handler );
	}
}

export class RoutesContainer {
	constructor ( method, sender ) {
		this.method = method;
		this.sender = sender;

		this.routes = {};
	}

	route ( receiver, route, handler ) {
		if ( !( route in this.routes ) ) {
			this.routes[ route ] = new RouteHandlers( route );

			this.routes[ route ].register( this );
		}

		return this.routes[ route ].add( receiver, handler );
	}
}

export class RouteHandlers {
	constructor ( route ) {
		this.route = route;
		this.handlers = new Map();
	}

	register ( container ) {
		let router = container.sender.server.router;
		let path = container.sender.prefix + this.route;

		return this.layer = router.register( path, [ container.method ], this.handler( container ), {
			name: null
		} );
	}

	handler ( container ) {
		let routes = this;

		return function * () {
			let server = container.sender.server;

			let receiver = yield server.receivers.get( this.params.receiver );

			let handler = routes.handlers.get( receiver );

			let media = yield server.media.get( this.params.media );

			this.body = yield Promise.resolve( handler.handler( receiver, media, this.request, this.response, this ) );
		};
	}

	add ( receiver, handler ) {
		this.handlers.set( receiver, {
			receiver: receiver,
			handler: handler
		} );

		return this.layer;
	}
}