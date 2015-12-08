export * from './Codecs/Index';

export * from './Rules/Index';

export function dsl ( domain, callback ) {
	let facades = domain.map( rule => rule.make.bind( rule ) );

	if ( callback ) {
		return callback( ...facades );
	}

	return facades;
}