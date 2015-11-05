export default class Factory {
	constructor () {
		this.creators = {};
		this.default = null;
	}

	setDefault ( name, ...options ) {
		this.default = [ name, options ];
	}

	define ( name, creator ) {
		this.creators[ name ] = creator;

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
			throw new Error( 'The Factory could not make a "' + name + '" ' );
		}

		return this.creators[ name ]( ...options );
	}
}