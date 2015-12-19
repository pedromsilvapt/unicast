import LocalProvider from '../Server/Providers/Local/Provider';
import Command from './Command';
import fs from 'fs-promise';
import path from 'path';

export default class Extract extends Command {
	constructor () {
		super();

		this.name = 'extract';
		this.description = 'Extracts streams from a set of folders/files';
		this.args = '<sources...>'
	}

	async getFilesFromSources ( sources ) {
		let files = [];

		for ( let source of sources ) {
			if ( ( await fs.lstatSync( source ) ).isDirectory() ) {
				files = files.concat( ( await fs.readdir( source ) ).map( name => path.join( source, file ) ) );
			} else {
				files.push( file );
			}
		}

		return files;
	}

	extractSubtitles ( files ) {
		let provider = new LocalProvider();

		return files.map( file => {
			return provider.itemEmbeddedSubtitles( file + '.mkv' ).then( function ( e ) {
				return e.content( file + '.srt', {
					onData: d => console.log( d.toString( 'utf-8' ) )
				} );
			} ).then( () => {
				console.log( file, 'finished' );
			} );
		} )
	}

	async execute ( sources, options ) {
		let files = this.getFilesFromSources( this.sources.map( source => path.isAbsolute( source ) ? source : path.resolve( path.join( process.cwd(), source ) ) ) );

		let promises = [];
		if ( options.subtitles ) {
			 promises = promises.concat( this.extractSubtitles( files, options.language ) );
		}

		return Promise.all( promises ).catch( e => console.error( 'ERROR', e, e.message, e.stack ) );
	}
}

//import LocalProvider from './Server/Providers/Local/Provider';
//
//let provider = new LocalProvider();
//
//let file = 'J:\\Series\\Marvels Jessica Jones\\Season 1\\Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY.mkv';
//
//let stream = provider.video( file );
//
//stream.metadata.then( m => {
//	console.log( m.streams.filter( c => c.codec_name !== 'srt' ) );
//} );

//let provider = new LocalProvider();
//
//let subtitles = [
//	//'Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	'Marvels.Jessica.Jones.S01E02.AKA.Crush.Syndrome.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E03.AKA.Its.Called.Whiskey.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E04.AKA.99.Friends.1080p.NF.WEBRip.DD5.1.x264-SNEAkY',
//	//'Marvels.Jessica.Jones.S01E05.AKA.The.Sandwich.Saved.Me.1080p.NF.WEBRip.DD5.1.x264-SNEAkY'
//].map( f => 'J:\\Series\\Marvels Jessica Jones\\Season 1\\' + f ).map( file => {
//	return provider.itemEmbeddedSubtitles( file + '.mkv' ).then( function ( e ) {
//		return e.content( file + '.srt', {
//			onData: d => console.log( d.toString( 'utf-8' ) )
//		} );
//	} ).then( () => {
//		console.log( file, 'finished' );
//	} );
//} );
//
//Promise.all( subtitles ).catch( e => console.error( 'ERROR', e, e.message, e.stack ) );


//	e.extract( 'J:\\Series\\Marvels Jessica Jones\\Season 1\\Marvels.Jessica.Jones.S01E01.AKA.Ladies.Night.1080p.NF.WEBRip.DD5.1.x264-SNEAkY.srt', e => console.log( e.timemark ), {
//		onError: ( error ) => {
//			console.log( error );
//		},
//		onEnd: () => {
//			console.log( 'END' );
//		}
//	} );
//} );