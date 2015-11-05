require( 'babel/register' )( {
	only: function ( filename ) {
		return filename.indexOf( '/camo/' ) !== -1 && filename.indexOf( '/camo/node_modules' ) === -1;
	}
} );

var install = require( 'source-map-support' ).install;
install();

require( 'babel/polyfill' );
require( './bin/app.js' );