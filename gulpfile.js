var path = require( 'path' );
var gulp = require( 'gulp' );
var babel = require( 'gulp-babel' );
var plumber = require( 'gulp-plumber' );
var cache = require( 'gulp-cached' );
var remember = require( 'gulp-remember' );
var watch = require( 'gulp-watch' );
var runSequence = require( 'run-sequence' );
var sourcemaps = require( 'gulp-sourcemaps' );
var newer = require( 'gulp-newer' );
var nodemon = require( 'gulp-nodemon' );

var FOLDERS = {};
FOLDERS.root = __dirname;
FOLDERS.source = path.join( FOLDERS.root, 'src' );
FOLDERS.target = path.join( FOLDERS.root, 'bin' );

gulp.task( 'build', function () {
	return gulp.src( path.join( FOLDERS.source, '**', '*.js' ) )
		.pipe( plumber() )
		.pipe( cache( 'es6' ) )
		.pipe( sourcemaps.init() )
		.pipe( babel() )
		.pipe( sourcemaps.write( '.', {
			sourceRoot: FOLDERS.source
		} ) )
		.pipe( gulp.dest( FOLDERS.target ) );
} );

gulp.task( 'copy', function () {
	return gulp.src( path.join( FOLDERS.source, '**', '*' ), { base: FOLDERS.source, ignore: '*.js' } )
		.pipe( plumber() )
		.pipe( newer( FOLDERS.target ) )
		.pipe( gulp.dest( FOLDERS.target ) );
} );

gulp.task( 'watch', function () {
	watch( path.join( FOLDERS.source, '**', '*.js' ), function ( vinyl ) {
		if ( vinyl.event === 'unlink' ) {
			delete cache.caches[ 'es6' ][ vinyl.path ];       // gulp-cached remove api
			remember.forget( 'es6', vinyl.path );             // gulp-remember remove api
		}

		runSequence( 'build' );
	} );

	watch( path.join( FOLDERS.source, '**', '*.!(js)' ), function ( vinyl ) {
		if ( vinyl.event === 'unlink' ) {
			//remember.forget( 'es6', vinyl.path );             // gulp-remember remove api
		}

		runSequence( 'copy' );
	} );
} );

gulp.task( 'server', function () {
	nodemon( {
		script: 'app.js',
		ext: 'js peg',
		watch: [ 'bin' ],
		delay: '2',
		execMap: {
			'js': 'node --harmony-proxies'
		},
		env: { 'NODE_ENV': 'development' }
	} )
} );

gulp.task( 'default', function ( done ) {
	runSequence( 'build', 'copy', 'watch', 'server', done );
} );