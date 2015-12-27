import RemoteVideo from '../../Utilities/RemoteVideo';
import ytdl from 'ytdl-core';
import fs from 'fs-promise';

export default class YoutubeVideo extends RemoteVideo {
	constructor ( url ) {
		super( url );

		console.log( url );
	}

	createReadStream ( offset ) {
		let options = { quality: 'highest', filter: format => format.container === 'mp4' };

		if ( offset ) {
			options.range = offset.start + '-' + offset.end;
		}

		console.log( options );
		return ytdl( this.source, options );
	}

	read ( offset ) {
		let result = super.read( offset );

		this.total = new Promise( ( resolve ) => {
			this.incoming.on( 'info', ( info, format ) => {
				resolve( parseInt( format.size, 10 ) )
			} )
		} );

		return result;
	}
}