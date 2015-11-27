var install = require( 'source-map-support' ).install;
install();

require( 'babel/polyfill' );
require( 'babel/register' )( {
	only: function ( filename ) {
		return filename.indexOf( '/camo/' ) !== -1 && filename.indexOf( '/camo/node_modules' ) === -1;
	}
} );

require( './bin/app.js' );