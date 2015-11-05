import { DefaultMediaReceiver } from 'castv2-client';
import DeviceStatus from './DeviceStatus';
import { Device } from 'chromecast-js'
import { Client } from 'castv2-client';
import promisify from 'es6-promisify';
import extend from 'extend';
import co from 'co';
import is from 'is';

export default class ChromecastDevice {
	constructor ( name, address ) {
		this.name = name;
		this.address = address;
		this.connected = false;

		this.client = new Device( {
			name: this.name,
			addresses: [ this.address ]
		} );

		let methods = [ 'connect', 'play', 'changeSubtitles', 'subtitlesOff', 'pause', 'unpause', 'changeSubtitlesSize', 'seek', 'seekTo', 'stop', 'setVolume', 'setVolumeMuted', 'close' ];

		for ( let field of methods ) {
			this.client[ field + 'Old' ] = this.client[ field ];

			this.client[ field ] = promisify( this.client[ field + 'Old' ] );
		}

		this.status = new DeviceStatus( this );
	}

	get player () {
		return this.client.player;
	}

	reconnect () {
		// Always use a fresh client when connecting
		if ( this.connected ) {
			this.client.close();
		}

		let client = this.client.client = new Client();
		return promisify( client.connect.bind( client ) )( this.address, () => {
			return this.getSessions( client );
		} ).then( apps => {
			return promisify( client.join.bind( client ) )( apps[ 0 ], DefaultMediaReceiver );
		} ).then( player => {
			this.client.player = player;
			this.client.emit( 'connected' );

			player.on( 'status', ( status ) => {
				if ( status ) {
					debug( 'status broadcast playerState=%s', status.playerState );
				} else {
					debug( '-' );
				}
			} );

			client.on( 'error', ( err ) => {
				console.log( 'Error: %s', err.message );
				this.client.connect( this.address );
				this.client.client.close();
			} );
		} );
	};

	connect () {
		this.waitingForConnection = this.client.connect().then( ( result ) => {
			this.connected = true;

			return result;
		} );

		return this.waitingForConnection;
	}

	whenConnected () {
		if ( this.waitingForConnection ) {
			return this.waitingForConnection;
		}

		return this.connect();
	}

	call ( method, args = [], status = true ) {
		return co( function * () {
			yield this.whenConnected();

			if ( !is.fn( method ) ) {
				method = this.client[ method ].bind( this.client );
			}

			let result = yield Promise.resolve( method( ...args ) );

			if ( status ) {
				yield this.status.changed();
			}

			return result;
		}.bind( this ) ).catch( ( error ) => {
			console.log( typeof error, error.message, error.stack );

			return Promise.reject( error );
		} );
	}

	load ( media, options = {} ) {
		return promisify( this.player.load.bind( this.player ) )( media, options ).then( status => {
			this.playing = true;

			return status;
		} );
	}

	play ( resource, options = {} ) {
		return this.call( () => {
			if ( !is.object( options ) ) {
				options = { currentTime: options };
			}

			options = extend( {
				autoplay: true,
				currentTime: 0
			}, options );

			let media = {
				contentId: resource,
				contentType: 'video/mp4'
			};

			if ( !is.string( resource ) ) {
				media.contentId = resource.url;

				if ( is.array( resource.subtitles ) && !is.array.empty( resource.subtitles ) ) {
					let tracks = [];

					for ( let [ index, subtitles ] of resource.subtitles.entries() ) {
						tracks.push( {
							trackId: index,
							type: 'TEXT',
							trackContentId: subtitles.url,
							trackContentType: subtitles.type || 'text/vtt',
							name: subtitles.name,
							language: subtitles.language,
							subtype: 'SUBTITLES'
						} );
					}

					media.tracks = tracks;
					options[ 'activeTrackIds' ] = [ 0 ];
				}

				if ( resource.subtitles_style ) {
					this.subtitles_style = media.textTrackStyle = resource.subtitles_style;
				}

				if ( resource.metadata ) {
					media.metadata = extend( {
						type: 0,
						metadataType: 0,
						title: resource.metadata.title,
						images: [
							{ url: resource.metadata.cover }
						]
					}, resource.metadata );

					delete media.metadata.cover;
				}
			}

			return this.load( media, options );
		}, [ resource, options ] );
	}

	changeSubtitles ( ...args ) {
		return this.call( 'changeSubtitles', args );
	}

	subtitlesOff ( ...args ) {
		return this.call( 'subtitlesOff', args );
	}

	pause ( ...args ) {
		return this.call( 'pause', args );
	}

	unpause ( ...args ) {
		return this.call( 'unpause', args );
	}

	changeSubtitlesSize ( ...args ) {
		return this.call( 'changeSubtitlesSize', args );
	}

	getStatus ( ...args ) {
		return this.call( () => {
			return new Promise( ( resolve, reject ) => {
				try {
					this.client.getStatus( ( status ) => {
						resolve( status );
					} );
				} catch ( err ) {
					reject( err );
				}
			} );
		}, args, false );
	}

	seek ( ...args ) {
		return this.call( 'seek', args );
	}

	seekTo ( ...args ) {
		return this.call( 'seekTo', args );
	}

	seekToPercentage ( percentage ) {
		return this.getStatus().then( ( status ) => {
			return co( function * () {
				let position = status.media.duration * Math.min( 100, Math.max( 0, percentage ) ) / 100;

				console.log( position, status.media.duration, percentage );

				yield this.pause();

				yield this.seekTo( position );

				yield this.unpause();
			}.bind( this ) );
		} );
	}

	changeVolume ( ...args ) {
		return this.call( 'changeVolume', args );
	}

	changeVolumeMuted ( ...args ) {
		return this.call( 'changeVolumeMuted', args );
	}

	stop ( ...args ) {
		return this.call( 'stop', args );
	}

	close ( ...args ) {
		return this.call( 'close', args );
	}

	getSubtitlesStyle () {
		return {
			backgroundColor: '#FFFFFF00', // see http://dev.w3.org/csswg/css-color/#hex-notation
			foregroundColor: '#FFFFFFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			edgeType: 'DROP_SHADOW', // can be: "NONE", "OUTLINE", "DROP_SHADOW", "RAISED", "DEPRESSED"
			edgeColor: '#000000FF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			fontScale: 1.3, // transforms into "font-size: " + (fontScale*100) +"%"
			fontStyle: 'BOLD', // can be: "NORMAL", "BOLD", "BOLD_ITALIC", "ITALIC",
			fontFamily: 'Droid Sans',
			fontGenericFamily: 'CURSIVE', // can be: "SANS_SERIF", "MONOSPACED_SANS_SERIF", "SERIF", "MONOSPACED_SERIF", "CASUAL", "CURSIVE", "SMALL_CAPITALS",
			windowColor: '#AA00FFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
			windowRoundedCornerRadius: 10, // radius in px
			windowType: 'ROUNDED_CORNERS' // can be: "NONE", "NORMAL", "ROUNDED_CORNERS"
		};
	}

	getSessions ( ...args ) {
		let client = new Client();

		return new promisify( client.connect.bind( client ) )( this.address ).then( () => {
			return promisify( client.getSessions.bind( client ) )( ...args );
		} );
	}
}