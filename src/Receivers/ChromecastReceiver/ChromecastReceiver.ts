import { BaseReceiver } from "../BaseReceiver/BaseReceiver";
import { GeneralRemote, ChromecastPlayOptions } from "./Remotes/General";
import DefaultMediaRemote from "./Remotes/DefaultMedia";
import { MediaPlayOptions, ReceiverStatus, ReceiverStatusState } from "../BaseReceiver/IMediaReceiver";
import { MediaStream, MediaStreamType } from "../../MediaProviders/MediaStreams/MediaStream";
import { UnicastServer } from "../../UnicastServer";
import { MessagesFactory } from "./MessagesFactory";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { HttpSender } from "../BaseReceiver/HttpSender";
import { ChromecastHttpSender } from "./ChromecastHttpSender";

export class ChromecastReceiver extends BaseReceiver {
    readonly address : string;

    client : DefaultMediaRemote;

    messagesFactory : MessagesFactory;

    sender : ChromecastHttpSender;

    constructor ( server : UnicastServer, name : string, address : string ) {
        super( server, name );

        this.address = address;

        this.client = new DefaultMediaRemote( this.address );

        this.sender = new ChromecastHttpSender( this );

        this.messagesFactory = new MessagesFactory( this.sender );

        const events : string[] = [ 
            'connected', 'playing', 'played', 'stopping', 'stopped',
            'pausing', 'paused', 'resuming', 'resumed', 'app-status',
            'status', 'error', 'disconnected'
        ];

        for ( let event of events ) {
            this.client.on( event, ( ...args ) => this.emit( event, ...args ) );
        }

        this.client.on( 'status', ( ...args ) => this.emit( 'inner-status', ...args ) );
    }

    async connect () : Promise<boolean> {
        if ( this.client.connected ) {
            return true;
        }

        await this.client.ensureConnection();

        return true;
    }

    async disconnect () : Promise<boolean> {
        if ( !this.client.connected ) {
            return true;
        }

        this.client.close();

        return true;
    }

    async reconnect () : Promise<boolean> {
        try {
            await this.disconnect();
        } finally {
            return this.connect();
        }
    }

    async play ( id : string ) : Promise<ReceiverStatus> {
        const [ streams, record, playOptions ] = await this.sessions.get( id );

        const video : VideoMediaStream = streams.find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;

        const options : ChromecastPlayOptions = {
            autoplay: true || playOptions.autostart,
            currentTime: playOptions.startTime
        };

        // if ( config && config.range && config.range.start ) {
        //     if ( await video.transcodable ) {
        //         options.currentTime = 0;

        //         if ( !( 'metadata' in media ) ) {
        //             media.metadata = {};
        //         }

        //         media.metadata.offset = config.range.start;
        //     } else {
        //         options.currentTime = config.range.start;
        //     }
        // }

        let media = await this.messagesFactory.createMediaMessage( id, streams, record, playOptions );

        if ( media.tracks && media.tracks.length ) {
            options.activeTrackIds = [ media.tracks[ 0 ].trackId ];
        }

        if ( !media.textTrackStyle ) {
            media.textTrackStyle = this.client.lastSubtitlesStyle || this.getSubtitlesStyle();
        }

        this.client.lastSubtitlesStyle = media.textTrackStyle;

        console.log( media );

        await this.client.load( media, options );

        // this.emit( 'playing', id, record, playOptions );

        // await this.client.load( media, options );

        // await super.play( item );

        // this.emit( 'play', item );
        return this.status();
    }

    getSubtitlesStyle () {
        return {
            backgroundColor: '#00000000', // see http://dev.w3.org/csswg/css-color/#hex-notation
            foregroundColor: '#FFFFFFFF', // see http://dev.w3.org/csswg/css-color/#hex-notation
            edgeType: 'OUTLINE', // can be: "NONE", "OUTLINE", "DROP_SHADOW", "RAISED", "DEPRESSED"
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

    async pause () : Promise<ReceiverStatus> {
        await this.client.pause();

        return this.status();
    }

    async resume () : Promise<ReceiverStatus> {
        await this.client.resume();

        return this.status();
    }

    async stop () : Promise<ReceiverStatus> {
        await this.client.stop();

        return this.status();
    }

    async status () : Promise<ReceiverStatus> {
        const status = await this.client.getStatus();

        if ( !status || !status.media || !status.media.metadata.session ) {
            return {
                session: null,
                timestamp: new Date(),
                state: ReceiverStatusState.Stopped,
                media: {
                    time: { duration: 0, current: 0 },
                    record: null
                },
                volume: { level: 1, muted: false },
                subtitlesStyle: null
            }
        }

        const [ streams, record, options ] = await this.sessions.get( status.media.metadata.session );

        const normalized : ReceiverStatus = {
            session: status.media.metadata.session,
            timestamp: new Date(),
            state: status.playerState,
            media: {
                time: { duration: status.media.duration, current: status.currentTime },
                record: record
            },
            volume: { level: status.volume.level, muted: false },
            subtitlesStyle: null
        }

        return normalized;
    }

    changeSubtitles ( ...args ) {
        return this.client.changeSubtitles( ...args );
    }

    subtitlesOff ( ...args ) {
        return this.client.subtitlesOff( ...args );
    }

    // pause ( ...args ) {
    //     return this.client.pause( ...args );
    // }

    // resume ( ...args ) {
    //     return this.client.resume( ...args );
    // }

    changeSubtitlesSize ( ...args ) {
        return this.client.changeSubtitlesSize( ...args );
    }

    async getStatus ( ...args ) {
        let status = await this.client.getStatus();

        if ( status && status.media ) {
            let item = await this.media.get( status.media.metadata.itemId );

            let video = await this.video( item );

            if ( await video.transcodable ) {
                status.media.duration = await video.duration;

                if ( status.media.metadata.offset ) {
                    status.currentTime += +status.media.metadata.offset;
                }
            }
        }

        status = new ChromecastReceiverStatus( status );

        this.emit( 'status', status );

        return status;
    }

    seek ( ...args ) {
        return this.client.seek( ...args );
    }

    seekTo ( ...args ) {
        return this.client.seekTo( ...args );
    }

    async seekToTime ( time ) {
        let item = await this.current;

        if ( !item ) {
            throw new Error( `No media currently playing in the receiver "${ this.name }"` );
        }

        let video = await this.video( item );

        if ( await video.transcodable ) {
            return this.play( item, {
                range: {
                    start: time
                }
            } )
        } else {
            await this.seekTo( time );

            return this.resume();
        }
    }

    async seekToPercentage ( percentage ) {
        let status = await this.getStatus();

        let position = status.media.duration * Math.min( 100, Math.max( 0, percentage ) ) / 100;

        await this.pause();

        await this.seekTo( position );

        await this.resume();
    }

    changeVolume ( ...args ) {
        return this.client.setVolume( ...args );
    }

    changeVolumeMuted ( ...args ) {
        return this.client.setVolumeMuted( ...args );
    }

    // async stop ( ...args ) {
    //     try {
    //         let result = await this.client.stop();

    //         await super.stop();

    //         return result;
    //     } catch ( error ) {
    //         if ( error.message == 'Cannot read property \'mediaSessionId\' of null' ) {
    //             return false;
    //         } else {
    //             throw error;
    //         }
    //     }
    // }

    toJSON () {
        return {
            type: this.type,
            name: this.name,
            address: this.address
        };
    }
}