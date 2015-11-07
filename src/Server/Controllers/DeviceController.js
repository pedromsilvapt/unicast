import fs from 'fs-promise';
import path from 'path';
import config from 'config';
import ReceiverController from './ReceiverController';
import PlaylistsController from './PlaylistsController';
import MediaManager from '../../MediaManager';

export default class DeviceController extends ReceiverController {
	static routes ( router, make ) {
		let device = make();

		device.post( '/play', this.action( 'play' ) );
		device.post( '/toggle', this.action( 'toggle' ) );
		device.post( '/pause', this.action( 'pause' ) );
		device.post( '/unpause', this.action( 'resume' ) );
		device.post( '/resume', this.action( 'resume' ) );
		device.post( '/stop', this.action( 'stop' ) );
		device.post( '/seek/:percentage', this.action( 'seek' ) );
		device.post( '/close', this.action( 'close' ) );
		device.get( '/volume', this.action( 'getVolume' ) );
		device.post( '/volume/:volume', this.action( 'setVolume' ) );
		device.post( '/mute', this.action( 'setVolumeMute' ) );
		device.get( '/status', this.action( 'status' ) );

		PlaylistsController.routes( device, make );

		router.use( '/device', device.routes() );
	}

	* play () {
		let device = yield this.receiver;

		let source = this.request.body.source;

		let subtitles = path.join( path.dirname( source ), path.basename( source, path.extname( source ) ) + '.srt' );

		if ( !( yield fs.exists( subtitles ) ) ) {
			subtitles = null;
		}

		let media = yield MediaManager.getInstance().store( {
			type: this.request.body.type,
			source: source,
			subtitles: subtitles,
			title: this.request.body.title,
			cover: this.request.body.cover,
			data: this.request.body.data || {}
		} );

		let status = yield MediaManager.getInstance().play( media, device, this.server );

		return media;
	}

	* toggle () {
		let device = yield this.receiver;

		let status = yield device.getStatus();

		if ( !status || !status.playerState ) {
			return;
		}

		if ( status.playerState == 'PLAYING' ) {
			return device.pause();
		} else {
			return device.resume();
		}
    }

	* pause () {
		let device = yield this.receiver;

		return device.pause();
    }

	* resume () {
		let device = yield this.receiver;

		return device.resume();
    }

	* stop () {
		let device = yield this.receiver;

		return device.stop();
    }

	* seek () {
		let device = yield this.receiver;

		let percentage = parseFloat( this.params.percentage.replace( ',', '.' ) );

		return device.seekToPercentage( percentage );
    }

	* status () {
		let device = yield this.receiver;

		let status = yield device.getStatus();

		return status || { mediaSessionIn: null };
	}

	* close () {
		let device = yield this.receiver;

		return yield device.close();
	}
}