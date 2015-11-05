import path from 'path';
import Controller from './Controller';
import MediaManager from '../../MediaManager';

export default class WatchController extends Controller {
	static routes ( router ) {
		router.get( '/watch/:id', this.action( 'watch', 'raw' ) );
		router.get( '/subtitles/:id', this.action( 'subtitles', 'raw' ) );
	}

	constructor ( ctx ) {
		super( ctx );
	}

	* watch () {
		let media = yield MediaManager.getInstance().get( this.params.id );

		let stream = this.server.providers.video( media.source, media );

 		return yield Promise.resolve( stream.serve( this.request, this.response ) );
	}

	* subtitles () {
		let media = yield MediaManager.getInstance().get( this.params.id );

		let stream = this.server.providers.subtitle( media.subtitles, media );

		return yield Promise.resolve( stream.serve( this.request, this.response ) );
    }
}