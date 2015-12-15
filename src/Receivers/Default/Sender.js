import is from 'is';

export default class Sender {
	constructor ( router ) {
		this.router = router;
		this.receiver = router.receiver;
		this.server = router.manager.server;
	}

	async stream ( stream, ctx ) {
		stream = await Promise.resolve( stream );

		let closeResult = () => {
			if ( is.fn( stream.end ) ) {
				console.log( 'terminate' );
				stream.end();
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

	register () {
		let result = this.router.get( '/video', this.video.bind( this ) );

		console.log( result.url( {
			receiver: 'ChromeSilvas',
			media: 'B82SSzcQeGWOv7kB'
		} ) );

		this.router.get( '/subtitles', this.subtitles.bind( this ) );
	}
}