import path from 'path';
import is from 'is';
import ReceiverController from './ReceiverController';
import MediaManager from '../../MediaManager';

export default class WatchController extends ReceiverController {
	static routes ( router ) {
		router.get( '/watch/:id', this.action( 'watch', 'raw' ) );
		router.get( '/subtitles/:id', this.action( 'subtitles', 'raw' ) );
	}

	constructor ( ctx ) {
		super( ctx );
	}

	* watch () {
		let receiver = yield this.receiver;

		let media = yield MediaManager.getInstance().get( this.params.id );

		let stream = this.server.providers.video( media.source, media, receiver );

 		let result = yield Promise.resolve( stream.serve( this.request, this.response ) );

		let closeResult = () => {
			if ( is.fn( result.end ) ) {
				console.log( 'terminate' );
				result.end();
			}
		};

		this.ctx.res.on( 'close', closeResult );
		this.ctx.res.on( 'end', closeResult );

		return result;
	}

	* subtitles () {
		let receiver = yield this.receiver;

		let media = yield MediaManager.getInstance().get( this.params.id );

		let stream = this.server.providers.subtitle( media.subtitles, media, receiver );

		return yield Promise.resolve( stream.serve( this.request, this.response ) );
    }
}