import { Buffered, Live } from '../../Server/Providers/StreamTypes';
import MediaFactory from './MediaFactory';
import BaseReceiver from '../Receiver';
import { Client } from 'castv2-client';
import { Device } from 'chromecast-js';
import promisify from 'es6-promisify';
import extend from 'extend';
import co from 'co';
import is from 'is';

export default class Receiver extends BaseReceiver {
	static get defaultMediaFactory () {
		if ( !this._mediaFactory ) {
			this._mediaFactory = new MediaFactory();
		}

		return this._mediaFactory;
	}

	static get type () {
		return 'chromecast';
	}

	constructor ( name, data = {} ) {
		super( name );

		this.client = new Device( {
			addresses: [ data.address ]
		} );

		this.connected = false;

		this.promisifyClientMethods();

		this.mediaFactory = Receiver.defaultMediaFactory;
	}

	get type () {
		return 'chromecast';
	}

	promisifyClientMethods ( methods = null ) {
		methods = methods || [ 'connect', 'play', 'changeSubtitles', 'subtitlesOff', 'pause', 'unpause', 'changeSubtitlesSize', 'seek', 'seekTo', 'stop', 'setVolume', 'setVolumeMuted', 'close' ];

		for ( let field of methods ) {
			if ( !( ( field + 'Old' ) in this.client ) ){
				this.client[ field + 'Old' ] = this.client[ field ];
			}

			this.client[ field ] = promisify( this.client[ field + 'Old' ].bind( this.client ) );
		}
	}

	get player () {
		return this.client.player;
	}

	get connection () {
		if ( this.waitingForConnection ) {
			return this.waitingForConnection;
		}

		return this.connect();
	}

	connect () {
		this.waitingForConnection = this.client.connect().then( ( result ) => {
			//this.client.client.receiver.on( 'status', ( status ) => {
			//	console.log( 'status', status );
			//} );

			this.connected = true;

			return result;
		} );

		return this.waitingForConnection;
	}

	/**
	 * Calls a method to interact with the chromecast device, but waits for a connection
	 * ( if there is none ) and forces an update of the status ( if appropriate )
	 *
	 * @param method The name or an anonymous function to execute
	 * @param args Optional arguments to be provided when calling the method
	 * @param updateStatus A boolean indicating whether after the action is complete, the status should be updated
	 * @returns {*}
	 */
	async callNative ( method, args = [], updateStatus = true ) {
		return co( function * () {
			yield this.connection;

			if ( !is.fn( method ) ) {
				method = this.client[ method ];
			}

			let result = yield Promise.resolve( method( ...args ) );

			if ( updateStatus ) {
				yield this.status.changed();
			}

			return result;
		}.bind( this ) ).catch( ( error ) => {
			console.log( typeof error, error, error.message, error.stack );

			return Promise.reject( error );
		} );
	}

	load ( media, options = {} ) {
		return this.callNative( () => {
			return promisify( this.player.load.bind( this.player ) )( media, options ).then( status => {
				this.playing = true;

				return status;
			} );
		} );

	}

	async play ( item, server, sender = null, options = {}, media = {} ) {
		if ( !is.object( options ) ) {
			options = { currentTime: options };
		}

		options = extend( {
			autoplay: true,
			currentTime: item.currentTime
		}, options );

		media = this.mediaFactory.make( item, server, media );

		if ( sender ) {
			let type = await sender.type;

			if ( type == Live ) {
				//media.contentType = 'application/x-mpegurl';
				//media.streamType = 'LIVE';
				console.log( media );
			}
		}

		if ( media.tracks && media.tracks.length ) {
			options.activeTrackIds = [ 0 ];
		}

		if ( media.textTrackStyle ) {
			this.subtitles_style = media.textTrackStyle;
		} else {
			media.textTrackStyle = this.getSubtitlesStyle();
		}

		await this.load( media, options );

		super.play( item, server );

		return media;
	}

	getSubtitlesStyle () {
		return {
			backgroundColor: '#FFFFFF00', // see http://dev.w3.org/csswg/css-color/#hex-notation
			foregroundColor: '#FFFFFFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			edgeType: 'DROP_SHADOW', // can be: "NONE", "OUTLINE", "DROP_SHADOW", "RAISED", "DEPRESSED"
			edgeColor: '#000000FF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			fontScale: 1.5, // transforms into "font-size: " + (fontScale*100) +"%"
			fontStyle: 'BOLD', // can be: "NORMAL", "BOLD", "BOLD_ITALIC", "ITALIC",
			fontFamily: 'Droid Sans',
			fontGenericFamily: 'CURSIVE', // can be: "SANS_SERIF", "MONOSPACED_SANS_SERIF", "SERIF", "MONOSPACED_SERIF", "CASUAL", "CURSIVE", "SMALL_CAPITALS",
			windowColor: '#AA00FFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			windowRoundedCornerRadius: 10, // radius in px
			windowType: 'ROUNDED_CORNERS' // can be: "NONE", "NORMAL", "ROUNDED_CORNERS"
		};
	}

	changeSubtitles ( ...args ) {
		return this.callNative( 'changeSubtitles', args );
	}

	subtitlesOff ( ...args ) {
		return this.callNative( 'subtitlesOff', args );
	}

	pause ( ...args ) {
		return this.callNative( 'pause', args );
	}

	resume ( ...args ) {
		return this.callNative( 'unpause', args );
	}

	changeSubtitlesSize ( ...args ) {
		return this.callNative( 'changeSubtitlesSize', args );
	}

	getStatus ( ...args ) {
		return this.callNative( () => {
			return new Promise( ( resolve, reject ) => {
				try {
					this.client.getStatus( ( status ) => {
						resolve( status );
					} );
				} catch ( error ) {
					reject( error );
				}
			} )
		}, args, false );
	}

	seek ( ...args ) {
		return this.callNative( 'seek', args );
	}

	seekTo ( ...args ) {
		return this.callNative( 'seekTo', args );
	}

	seekToPercentage ( percentage ) {
		return this.getStatus().then( ( status ) => {
			return co( function * () {
				let position = status.media.duration * Math.min( 100, Math.max( 0, percentage ) ) / 100;

				console.log( position, status.media.duration, percentage );

				yield this.pause();

				yield this.seekTo( position );

				yield this.resume();
			}.bind( this ) );
		} );
	}

	changeVolume ( ...args ) {
		return this.callNative( 'changeVolume', args );
	}

	changeVolumeMuted ( ...args ) {
		return this.callNative( 'changeVolumeMuted', args );
	}

	stop ( ...args ) {
		return this.callNative( 'stop', args );
		return this.callNative( () => {
			return this.stop().then( ( result ) => {
				super.stop();

				return result;
			} );
		}, args );
	}

	close ( ...args ) {
		return this.callNative( 'close', args );
	}
}