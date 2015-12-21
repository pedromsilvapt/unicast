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