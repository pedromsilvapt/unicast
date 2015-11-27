export default class Deferred {
	constructor () {
		this.promise = new Promise( ( resolve, reject ) => {
			this.resolveHandler = resolve;
			this.rejectHandler = reject;
		} );
	}

	get resolveHandler () {
		return this._resolveHandler;
	}

	set resolveHandler ( value ) {
		this._resolveHandler = value;

		if ( this.resolved ) {
			value( this.resolvedData );
		}
	}

	get rejectHandler () {
		return this._rejectHandler;
	}

	set rejectHandler ( value ) {
		this._rejectHandler = value;

		if ( this.rejected ) {
			value( this.rejectedData );
		}
	}

	resolve ( data ) {
		if ( this.resolveHandler ) {
			this.resolveHandler( this.resolvedData );
		} else {
			this.resolved = true;
			this.resolvedData = data;
		}
	}

	reject ( data ) {
		if ( this.rejectHandler ) {
			this.rejectHandler( this.rejectedData );
		} else {
			this.rejected = true;
			this.rejectedData = data;
		}
	}
}