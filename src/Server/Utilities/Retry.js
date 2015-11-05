export var TimedOut = new Symbol( 'TimedOut' );

export default function Retry ( promise, timeout = 5000, retries = 3 ) {
	let timeoutToken = PromisedTimeout( timeout );

	let retried = false;
	return Promise.race( Promise.resolve( promise() ), timeoutToken ).then( ( res ) => {
		if ( res === TimedOut && retries > 0 && !retried ) {
			retried = true;

			return Retry( promise, timeout, retries - 1 );
		}

		return res;
	} ).catch( ( error ) => {
		if ( retries > 0 && !retried ) {
			retried = true;

			return Retry( promise, timeout, retries - 1 );
		}

		return Promise.reject( error );
	} );
}

export function PromisedTimeout ( delay ) {
	let promise = new Promise( ( resolve, reject ) => {
		let token = setTimeout( () => {
			resolve( TimedOut );
		}, delay );

		promise.cancel = () => {
			clearTimeout( token );

			reject( TimedOut );
		};
	} );

	return promise;
}