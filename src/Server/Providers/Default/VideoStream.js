import { Buffered, Live } from '../StreamTypes';
import rangeParser from 'range-parser';
import TempFile from '../../Utilities/TempFile';
import fs from 'fs-promise';
import mime from 'mime';

export default class VideoStream {
	constructor ( receiver = null ) {
		this.receiver = receiver;
	}

	async serve ( request, response ) {
		let size = await Promise.resolve( this.size );
		let mime = await Promise.resolve( this.mime );
		let range = request.headers.range;

		response.set( 'Content-Type', mime );
		response.set( 'Access-Control-Allow-Origin', '*' );

		if ( !range || await this.live ) {
			console.log( 'norange', size );

			if ( !( await this.live ) ) {
				response.set( 'Content-Length', size );
			}

			response.status = 200;

			return this.read();
		} else {
			let part = rangeParser( size, range )[ 0 ];
			console.log( 'with range', part, size );

			response.set( 'Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + size );
			response.set( 'Accept-Ranges', 'bytes' );
			response.set( 'Content-Length', ( part.end - part.start ) + 1 );
			response.status = 206;

			return this.read( part );
		}
	}
}