import FFMpeg from '../../Utilities/FFMpeg';
import fs from 'fs-promise';
import rangeParser from 'range-parser';
import mime from 'mime';
import co from 'co';

// Transcoders
import Transcoder from '../../Transcoders/Transcoder';
import DTSAudio from '../../Transcoders/DTSAudio';

export default class VideoStream {
	constructor ( filepath ) {
		this.filepath = filepath;
	}

	serve ( request, response ) {
		return co( function * () {
			let metadata = yield FFMpeg.probe( this.filepath );

			//console.log( metadata.streams.filter( s => s.codec_type === 'audio' ) );

			let stat = fs.statSync( this.filepath );
			let total = stat.size;
			let range = request.headers.range;
			let type = mime.lookup( this.filepath );

			response.set( 'Content-Type', type );
			response.set( 'Access-Control-Allow-Origin', '*' );

			let file;
			let part;
			if ( !range ) {
				console.log( 'norange', total );
				response.set( 'Content-Length', total );
				response.status = 200;

				file = fs.createReadStream( this.filepath );
			} else {
				part = rangeParser( total, range )[ 0 ];
				let chunksize = ( part.end - part.start ) + 1;

				file = fs.createReadStream( this.filepath, { start: part.start, end: part.end } );

				console.log( 'with range', part, total );

				response.set( 'Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total );
				response.set( 'Accept-Ranges', 'bytes' );
				response.set( 'Content-Length', chunksize );
				response.status = 206;
			}

			let transcoder = new Transcoder();

			return transcoder.run( file, part, metadata, [ new DTSAudio() ] );
		}.bind( this ) );
	}
}