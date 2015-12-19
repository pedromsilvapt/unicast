import fs from 'fs-promise';
import path from 'path';
import config from 'config';
import ReceiverController from './ReceiverController';
import PlaylistsController from './PlaylistsController';

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
		device.post( '/volume/mute', this.action( 'setVolumeMute' ) );
		device.post( '/volume/:volume', this.action( 'setVolume' ) );
		device.post( '/subtitles/size/:size', this.action( 'setSubtitlesSize' ) );
		device.post( '/subtitles/track/:index', this.action( 'setSubtitlesIndex' ) );
		device.post( '/mute', this.action( 'setVolumeMute' ) );
		device.get( '/status', this.action( 'status' ) );

		PlaylistsController.routes( device, make );

		router.use( '/device/:receiver', device.routes() );
	}

	async play () {
		let device = await this.receiver;

		let source = this.request.body.source;

		let item = await this.server.providers.item( source, null, this.request );

		let media = await this.server.media.store( item );

		let status = await this.server.media.play( media, device );

		return media;
	}

	async toggle () {
		let device = await this.receiver;

		let status = await device.getStatus();

		if ( !status || !status.playerState ) {
			return;
		}

		if ( status.playerState == 'PLAYING' ) {
			return device.pause();
		} else {
			return device.resume();
		}
    }

	async pause () {
		let device = await this.receiver;

		return device.pause();
    }

	async resume () {
		let device = await this.receiver;

		return device.resume();
    }

	async stop () {
		let device = await this.receiver;

		return device.stop();
    }

	async seek () {
		let device = await this.receiver;

		let percentage = parseFloat( this.params.percentage.replace( ',', '.' ) );

		return device.seekToPercentage( percentage );
    }

	async status () {
		let device = await this.receiver;

		let status = await device.getStatus();

		return status || { mediaSessionIn: null };
	}

	async getVolume () {
		return ( await this.status() ).volume || {};
	}

	async setVolume () {
		let device = await this.receiver;

		let volume = this.params.volume / 100;

		await device.changeVolume( volume );

		return this.getVolume();
	}

	async setVolumeMute () {
		let device = await this.receiver;

		//let volume = await this.getVolume();

		await device.changeVolumeMuted( !device.muted );

		device.muted = !device.muted;

		return this.getVolume();
	}

	async setSubtitlesSize () {
		let device = await this.receiver;

		await device.changeSubtitlesSize( parseInt( this.params.size, 10 ) / 100 );

		return { success: true };
	}

	async close () {
		let device = await this.receiver;

		return device.close();
	}
}