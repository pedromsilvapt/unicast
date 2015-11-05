import YoutubeVideo from '../../Utilities/YoutubeVideo';
import rangeParser from 'range-parser';
import fs from 'fs-promise';
import li from 'link-id';
import co from 'co';

export default class VideoStream {
	constructor ( video ) {
		this.video = video;
		this.info = li( video );
	}

	static get ( video ) {
		if ( !( 'cache' in this ) ) {
			this.cache = {};
		}

		if ( !( video in this.cache ) ) {
			this.cache[ video ] = new YoutubeVideo( video );
		}

		return this.cache[ video ];
	}

	serve ( request, response ) {
		return co( function * () {
			let stream = VideoStream.get( this.video );

			let range = request.headers.range;

			response.set( 'Content-Type', 'video/mp4' );
			response.set( 'Access-Control-Allow-Origin', '*' );

			if ( !range ) {
				response.set( 'Content-Length', total );
				response.status = 200;

				return stream.read();
			}

			let total = yield stream.total;

			let part = rangeParser( total, range )[ 0 ];
			let chunksize = ( part.end - part.start ) + 1;

			//yield stream.when( part.end );

			response.set( 'Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total );
			response.set( 'Accept-Ranges', 'bytes' );
			response.set( 'Content-Length', chunksize );
			response.status = 206;

			return stream.read( { start: part.start, end: part.end } );
		}.bind( this ) );
	}
}