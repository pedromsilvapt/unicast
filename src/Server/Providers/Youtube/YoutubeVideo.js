import RemoteVideo from '../../Utilities/RemoteVideo';
import ytdl from 'ytdl-core';
import fs from 'fs-promise';

export default class YoutubeVideo extends RemoteVideo {
	constructor ( url ) {
		super( ytdl( url, { quality: 'highest', filter: format => format.container === 'mp4' } ) );

		console.log( url );

		this.total = new Promise( ( resolve ) => {
			this.incoming.on( 'info', ( info, format ) => {
				resolve( parseInt( format.size, 10 ) )
			} )
		} );
	}
}