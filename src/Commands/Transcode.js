import FFMpeg from '../Server/Utilities/FFMpeg';
import Transcoder from '../Server/Transcoders/Transcoder';
import MediaServer from '../Server/MediaServer';
import Command from './Command';
import fs from 'fs-promise';
import path from 'path';

export default class Transcode extends Command {
	constructor () {
		super();

		this.name = 'transcode';
		this.description = 'Transcodes a file for a given receiver';
		this.args = '<source> <destination> <receiver>'
	}

	async execute ( source, destination, receiverName, options ) {
		[ source, destination ] = [ source, destination ].map( file => {
			if ( !path.isAbsolute( file ) ) {
				return path.resolve( path.join( process.cwd(), file ) );
			}

			return file;
		} );

		let server = new MediaServer();

		await server.initialize();

		let receiver = await server.receivers.get( receiverName );

		let file = fs.createReadStream( source );

		let transcoder = new Transcoder( receiver.transcoders );

		let metadata = await FFMpeg.probe( source );

		let length = 0;
		transcoder.run( file, metadata ).pipe( fs.createWriteStream( destination ) );
	}
}