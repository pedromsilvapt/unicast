import is from 'is';

export default class Observer {
	constructor ( events = [] ) {
		this._events = events;
	}

	register ( subject ) {
		this._subject = subject;

		for ( let event of this._events ) {
			let onceKey = 'once' + event;
			if ( is.fn( this[ onceKey ] ) ) {
				this._subject.once( event, this[ onceKey ].bind( this ) );
			}

			if ( is.fn( this[ event ] ) ) {
				this._subject.on( event, this[ event ].bind( this ) );
			}
		}
	}
}