export default class Factory {
	constructor () {
		this.creators = {};
		this.default = null;
	}

	setDefault ( name, ...options ) {
		this.default = [ name, options ];
	}

	define ( name, creator, singleton = false ) {
		this.creators[ name ] = {
			fn: creator,
			singleton: singleton
		};

		return this;
	}

	has ( name ) {
		return name in this.creators;
	}

	make ( name = null, ...options ) {
		if ( !name ) {
			[ name, ...options ] = this.default;
		}

		if ( !this.has( name ) ) {
			throw new Error( 'The Factory could not make a "' + name + '"' );
		}

		let creator = this.creators[ name ];

		if ( creator.singleton && creator.instance ) {
			return creator.instance;
		}

		let instance = creator.fn( ...options );

		if ( creator.singleton ) {
			this.creators[ name ].instance = instance;
		}

		return instance;
	}
}