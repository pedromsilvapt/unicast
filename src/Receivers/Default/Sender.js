import is from 'is';

export default class Sender {
	constructor ( router ) {
		this.router = router;
		this.receiver = router.receiver;
		this.server = router.manager.server;

		this.streamEndMethods = [ 'end', 'close', 'destroy' ];

		this.urlStore = {};
	}

	async stream ( stream, ctx ) {
		stream = await Promise.resolve( stream );

		let closeResult = () => {
			if ( is.fn( this.streamEndMethods ) ) {
				this.streamEndMethods( stream );

				console.log( 'terminate' );
			} else {
				for ( let method of this.streamEndMethods ) {
					if ( is.fn( stream[ method ] ) ) {
						console.log( 'terminate' );
						stream[ method ]();
						break;
					}
				}
			}
		};

		ctx.res.on( 'close', closeResult );
		ctx.res.on( 'end', closeResult );

		return stream;
	}

	async video ( receiver, media, request, response, ctx ) {
		let stream = this.server.providers.video( media.source, media, receiver );

		return this.stream( stream.serve( request, response ), ctx );
	}

	subtitles ( receiver, media, request, response, ctx ) {
		let stream = this.server.providers.subtitle( media.subtitles, media, receiver );

		return stream.serve( request, response );
	}

	registerUrl ( name, layer ) {
		this.urlStore[ name ] = layer;
	}

	url ( name, params = {} ) {
		let url = this.urlStore[ name ].url( params );

		if ( url ) {
			return this.server.url( url.split( '/' ) );
		}
	}

	register () {
		this.registerUrl( 'video', this.router.get( '/video', this.video.bind( this ) ) );

		this.registerUrl( 'subtitles', this.router.get( '/subtitles', this.subtitles.bind( this ) ) );
	}
}