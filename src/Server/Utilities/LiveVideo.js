import WriteReadStream from './IO/WriteReadStream';
import fs from 'fs-promise';
import config from 'config';
import path from 'path';
import guid from 'guid';

export default class LiveVideo extends WriteReadStream {
	static get folder () {
		return path.resolve( path.join( config.get( 'storage' ), 'live' ) );
	}

	static async clear () {
		let folder = this.folder;

		await fs.emptyDir( folder );
	}

	static random () {
		return path.join( this.folder, guid.raw(), 'video.mkv' );
	}

	constructor () {
		super();

		this.destination = this.constructor.random();

		fs.ensureDirSync( path.dirname( this.destination ) );

		this.writer = this.createWriter( this.destination );
	}
}