export default class Dictionary {
	constructor () {
		this.items = {};
	}

	has ( key ) {
		return key in this.items;
	}

	hasNot ( key ) {
		return !this.has( key );
	}

	set ( key, item ) {
		this.items[ key ] = item;
	}

	add ( key, item ) {
		if ( !this.has( key ) ) {
			this.set( key, item );
		}
	}

	get ( key ) {
		if ( this.hasNot( key ) ) {
			return null;
		}

		return this.items[ key ];
	}

	* entries () {
		for ( let key of Object.keys( this.items ) ) {
			yield [ key, this.items[ key ] ];
		}
	}

	* keys () {
		for ( let key of Object.keys( this.items ) ) {
			yield key;
		}
	}

	* values () {
		for ( let key of Object.keys( this.items ) ) {
			yield this.items[ key ];
		}
	}

	[ Symbol.iterator ] () {
		return this.entries();
	}
}