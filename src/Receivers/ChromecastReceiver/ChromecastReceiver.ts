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
import { ChromecastHlsTranscoder } from "./Transcoders/ChromecastHlsTranscoder";
import { InvalidArgumentError } from "restify-errors";

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

        this.transcoder = new ChromecastHlsTranscoder( this );

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

    get connected () : boolean {
        return this.client.isOpened;
    }

    async connect () : Promise<boolean> {
        if ( !this.client.isConnected ) {
            await this.client.open();
        }

        return true;
    }

    async disconnect () : Promise<boolean> {
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
        // Get the session information
        const [ streams, record, playOptions ] = await this.sessions.get( id );

        // Find the video stream
        const video : VideoMediaStream = streams.find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;

        if ( !video ) {
            throw new Error( `Trying to play media with no video stream is not currently supported.` );
        }

        const options : ChromecastPlayOptions = {
            autoplay: true || playOptions.autostart,
            currentTime: playOptions.startTime
        };

        let media = await this.messagesFactory.createMediaMessage( id, streams, record, playOptions );

        if ( media.tracks && media.tracks.length ) {
            options.activeTrackIds = [ media.tracks[ 0 ].trackId ];
        }

        if ( !media.textTrackStyle ) {
            media.textTrackStyle = this.client.lastSubtitlesStyle || this.getSubtitlesStyle();
        }

        this.client.lastSubtitlesStyle = media.textTrackStyle;

        await this.client.load( media, options );

        this.sessions.current = id;

        this.emit( 'play', id );

        this.changeSubtitlesSize( this.client.lastSubtitlesStyle.fontScale );

        // this.emit( 'playing', id, record, playOptions );

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

        this.emit( 'pause', this.sessions.current );

        return this.status();
    }

    async resume () : Promise<ReceiverStatus> {
        await this.client.resume();

        this.emit( 'resume', this.sessions.current );

        return this.status();
    }

    async stop () : Promise<ReceiverStatus> {
        await this.client.stop();

        await this.sessions.release( this.sessions.current );

        const id = this.sessions.current;

        this.sessions.current = null;
        
        this.emit( 'stop', id );

        return this.status();
    }

    async status () : Promise<ReceiverStatus> {
        const status = await this.client.getStatus();

        if ( !status || !status.media || !status.media.metadata.session ) {
            return {
                timestamp: new Date(),
                state: ReceiverStatusState.Stopped,
                media: {
                    time: { duration: 0, current: 0 },
                    record: null,
                    session: null
                },
                volume: { level: 1, muted: false },
                subtitlesStyle: null
            }
        }

        const [ streams, record, options ] = await this.sessions.get( status.media.metadata.session );

        const normalized : ReceiverStatus = {
            timestamp: new Date(),
            state: status.playerState,
            media: {
                time: { duration: status.media.duration, current: status.currentTime },
                record: record,
                session: await this.server.database.tables.history.get( status.media.metadata.session )
            },
            volume: { level: Math.round( status.volume.level * 100 ), muted: status.volume.muted },
            subtitlesStyle: {
                size: this.client.lastSubtitlesStyle.fontScale
            }
        };

        return normalized;
    }

    async changeSubtitles ( index : number ) : Promise<ReceiverStatus> {
        await this.client.changeSubtitles( index );

        return this.status();
    }

    async subtitlesOff () : Promise<ReceiverStatus> {
        await this.client.subtitlesOff();

        return this.status();        
    }

    async changeSubtitlesSize ( size : number ) : Promise<ReceiverStatus> {
        this.client.lastSubtitlesStyle.fontScale = size;

        await this.client.changeSubtitlesSize( size );

        return this.status();
    }

    async seek ( time : number ) : Promise<ReceiverStatus> {
        await this.client.seek( time );

        return this.status();
    }

    async seekTo ( time : number ) : Promise<ReceiverStatus> {
        await this.client.seekTo( time );

        return this.status();
    }

    async setVolume ( volume : number ) : Promise<ReceiverStatus> {
        await this.client.setVolume( Math.round( volume ) / 100 );

        return this.status();
    }

    async mute () : Promise<ReceiverStatus> {
        await this.client.setVolumeMuted( true );

        return this.status();
    }

    async unmute () : Promise<ReceiverStatus> {
        await this.client.setVolumeMuted( false );

        return this.status();
    }

    async callCommand<R = any, A extends any[] = any[]> ( commandName : string, args : A ) : Promise<R> {    
        if ( commandName in this ) {
            return this[ commandName ]( ...args );
        }

        throw new InvalidArgumentError();
    }

    toJSON () {
        return {
            type: this.type,
            name: this.name,
            address: this.address
        };
    }
}