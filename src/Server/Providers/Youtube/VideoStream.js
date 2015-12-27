import DefaultVideoStream from '../Default/VideoStream';
import LiveVideo from '../../Utilities/LiveVideo';
import YoutubeVideo from './YoutubeVideo';
import rangeParser from 'range-parser';
import { Live } from '../StreamTypes';
import fs from 'fs-promise';
import li from 'link-id';

export default class VideoStream extends DefaultVideoStream {
	constructor ( video ) {
		super();

		this.video = video;
		this.info = li( video );
		this.live = true;
	}

	get type () {
		return Promise.resolve( Live );
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

	//async serve ( request, response ) {
	//	console.log( 'serve' );
	//	let stream = VideoStream.get( this.video );
	//	console.log( 'stream' );
	//
	//	let range = request.headers.range;
	//
	//	response.set( 'Content-Type', 'video/mp4' );
	//	response.set( 'Access-Control-Allow-Origin', '*' );
	//
	//	if ( !range ) {
	//		response.set( 'Content-Length', total );
	//		response.status = 200;
	//
	//		console.log( 'norange', 'read' );
	//
	//		return stream.read();
	//	}
	//
	//	let total = await stream.total;
	//
	//	let part = rangeParser( total, range )[ 0 ];
	//	let chunksize = ( part.end - part.start ) + 1;
	//
	//	await stream.when( part.start );
	//
	//	response.set( 'Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total );
	//	response.set( 'Accept-Ranges', 'bytes' );
	//	response.set( 'Content-Length', chunksize );
	//	response.status = 206;
	//
	//	return stream.read( { start: part.start, end: part.end } );
	//}

	get total () {
		return VideoStream.get( this.video ).total;
	}

	async read ( offset = null ) {
		let stream = VideoStream.get( this.video );

		if ( offset ) {
			return stream.read( offset ).pipe( new LiveVideo() );
		}

		return stream.read().pipe( new LiveVideo() );
	}
}