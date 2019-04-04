import { BaseReceiver } from "../../../Receivers/BaseReceiver/BaseReceiver";
import { ChromecastPlayOptions } from "./Remotes/General";
import DefaultMediaRemote from "./Remotes/DefaultMedia";
import { MediaPlayOptions, ReceiverStatus, ReceiverStatusState, ReceiverTranscodingStatus } from "../../../Receivers/BaseReceiver/IMediaReceiver";
import { MediaStreamType } from "../../../MediaProviders/MediaStreams/MediaStream";
import { UnicastServer } from "../../../UnicastServer";
import { MessagesFactory } from "./MessagesFactory";
import { VideoMediaStream } from "../../../MediaProviders/MediaStreams/VideoStream";
import { ChromecastHttpSender } from "./ChromecastHttpSender";
import { ChromecastHlsTranscoder } from "./Transcoders/ChromecastHlsTranscoder";
import { InvalidArgumentError } from "restify-errors";
import { TranscodingSession } from "../../../Transcoding/Transcoder";
import { MediaStreamSelectors } from "../../../MediaProviders/MediaStreams/MediaStreamSelectors";
import { HlsVideoMediaStream } from "../../../Transcoding/FFmpegHlsDriver/HlsVideoMediaStream";
import { Logger } from 'clui-logger';

export interface ChromecastSubtitlesConfig {
    lineFilters ?: (string | RegExp)[]
    delay: {
        preloadCount : number;
        duration : number;
        rollback : number;
    },
    style?: {
        default?: any;
        custom?: any[];
    }
}

export interface ChromecastConfig {
    subtitles ?: ChromecastSubtitlesConfig
}

export class ChromecastReceiver extends BaseReceiver {
    readonly address : string;

    client : DefaultMediaRemote;

    messagesFactory : MessagesFactory;

    sender : ChromecastHttpSender;

    subtitlesStyle : ChromecastSubtitlesStyles;

    config : ChromecastConfig;

    logger : Logger;

    constructor ( server : UnicastServer, name : string, address : string, config : ChromecastConfig = {} ) {
        super( server, name );

        this.address = address;

        this.config = config;

        this.client = this.createClient();
        
        this.sender = new ChromecastHttpSender( this );

        this.messagesFactory = new MessagesFactory( this.sender );

        this.transcoder = new ChromecastHlsTranscoder( this );

        this.logger = this.server.logger.service( `Receivers/${ this.type }/${ this.name }` );

        this.subtitlesStyle = new ChromecastSubtitlesStyles( {
            ...this.getDefaultSubtitlesStyle(),
            ...this.config.subtitles.style.default
        }, this.config.subtitles.style.custom || [ {
            backgroundColor: '#00000000',
        }, {
            backgroundColor: '#00000055',
        }, {
            backgroundColor: '#000000AA',
        } ] );
    }

    protected createClient () : DefaultMediaRemote {
        const client = new DefaultMediaRemote( this.address );

        const events : string[] = [ 
            'connected', 'playing', 'played', 'stopping', 'stopped',
            'pausing', 'paused', 'resuming', 'resumed', 'app-status',
            'status', 'disconnected'
        ];

        for ( let event of events ) {
            client.on( event, ( ...args ) => this.emit( event, ...args ) );
        }

        client.on( 'status', ( ...args ) => this.emit( 'inner-status', ...args ) );

        client.on( 'connected', () => this.logger.info( 'Connected to device' ) );

        client.on( 'disconnected', () => this.logger.info( 'Disconnected from device' ) );

        client.on( 'player-joined', () => this.logger.info( 'Joined player session' ) );

        client.on( 'player-launched', () => this.logger.info( 'Launched playing session' ) );
        
        client.on( 'error', error => {
            this.logger.error( error.message, error );
            
            this.reconnect().catch( error => this.logger.error( error.message, error ) );
        } );

        return client;
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
        try {
            await this.client.disconnect();
        } catch ( err ) {
            this.logger.error( err.message, err );

            this.client = this.createClient();
        }
        
        return true;
    }

    async reconnect () : Promise<boolean> {
        try {
            await this.disconnect();
        } finally {
            return this.connect();
        }
    }

    async turnoff () : Promise<ReceiverStatus> {
        try {
            await this.client.close();
        } catch ( err ) {
            this.logger.error( err.message, err );

            this.client = this.createClient();
        }

        if ( this.sessions.current ) {
            this.sessions.release( this.sessions.current );
        }
        
        return this.status();
    }

    async play ( id : string, customOptions : Partial<MediaPlayOptions> = {} ) : Promise<ReceiverStatus> {
        // Get the session information
        const { streams, record, options: recordPlayOptions } = await this.sessions.get( id );

        // Find the video stream
        const video : VideoMediaStream = streams.find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;

        const playOptions : MediaPlayOptions = { ...recordPlayOptions, ...customOptions };

        try {
            if ( !video ) {
                throw new Error( `Trying to play media with no video stream is not currently supported.` );
            }
    
            const options : ChromecastPlayOptions = {
                autoplay: typeof playOptions.autostart === 'boolean' ? playOptions.autostart : true,
                currentTime: Math.max( playOptions.startTime, 0 )
            };
    
            let media = await this.messagesFactory.createMediaMessage( id, streams, record, playOptions );
    
            if ( media.tracks && media.tracks.length ) {
                const activeTrackIndex = this.messagesFactory.getTrackIndexForOffset( 0, playOptions, playOptions.subtitlesOffset || 0 );

                if ( activeTrackIndex !== null ) {
                    options.activeTrackIds = [ media.tracks[ activeTrackIndex ].trackId ];
                } else {
                    this.server.onError.notify( new Error( `No active track index found for delay 0.` ) );
                }
            }
    
            media.textTrackStyle = this.subtitlesStyle.style;
    
            if ( this.sessions.current != null && this.sessions.current != id ) {
                await this.sessions.release( this.sessions.current );
            }
    
            await this.client.load( media, options );
    
            this.sessions.current = id;
    
            this.emit( 'play', id );
    
            await this.changeSubtitlesSize( this.subtitlesStyle.fontScale );
        } catch ( err ) {
            this.sessions.release( id );

            if ( this.sessions.current == id ) this.sessions.current = null;

            throw err;
        }

        return this.status();
    }

    getDefaultSubtitlesStyle () {
        return {
            backgroundColor: '#00000000', // see http://dev.w3.org/csswg/css-color/#hex-notation //#000000AA
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

    statusTranscoding ( status : any, transcoding : TranscodingSession ) : ReceiverTranscodingStatus {
        if ( !transcoding ) {
            return null;
        }

        const video = MediaStreamSelectors.firstVideo( transcoding.getMappedOutputs() );
        
        if ( HlsVideoMediaStream.is( video ) ) {
            const report = video.task.getProgressReport( status.currentTime );

            return { duration: status.media.duration, ...report, task: video.task.id };
        }

        return null;
    }

    async status () : Promise<ReceiverStatus> {
        const status = await this.client.getStatus();

        if ( !status || !status.media || !status.media.metadata.session ) {
            return {
                timestamp: new Date(),
                state: ReceiverStatusState.Stopped,
                media: {
                    time: { duration: 0, current: 0, speed: 0 },
                    transcoding: null,
                    record: null,
                    session: null,
                    options: {}
                },
                volume: { level: 1, muted: false },
                subtitlesStyle: null
            }
        }

        const { record, transcoding } = await this.sessions.get( status.media.metadata.session );

        const normalized : ReceiverStatus = {
            timestamp: new Date(),
            state: status.playerState,
            media: {
                time: { duration: status.media.duration, current: status.currentTime, speed: status.playerState == ReceiverStatusState.Playing ? 1 : 0 },
                transcoding: transcoding ? this.statusTranscoding( status, transcoding ) : null,
                record: record,
                session: await this.server.database.tables.history.get( status.media.metadata.session ),
                options: status.media.metadata.options
            },
            volume: { level: Math.round( status.volume.level * 100 ), muted: status.volume.muted },
            subtitlesStyle: {
                size: this.subtitlesStyle.fontScale
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
        await this.client.changeSubtitlesStyle( this.subtitlesStyle.setFontScale( size ).style );

        return this.status();
    }

    async changeSubtitlesStyle ( index : number ) : Promise<ReceiverStatus> {
        await this.client.changeSubtitlesStyle( this.subtitlesStyle.setCustomStyleIndex( index ).style );

        return this.status();
    }

    async cycleSubtitlesStyle () : Promise<ReceiverStatus> {
        await this.client.changeSubtitlesStyle( this.subtitlesStyle.cycleCustomStyles().style );

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

    async getSubtitlesOffset () : Promise<number> {
        if ( !this.sessions.current ) {
            return 0;
        }
        
        const { options } = await this.sessions.get( this.sessions.current );
        
        return options.subtitlesOffset || 0;
    }

    async setSubtitlesOffset ( offset : number ) {
        let status = await this.status();

        const id = this.sessions.current;
        
        const { options } = await this.sessions.get( id );

        const index = this.messagesFactory.getTrackIndexForOffset( 0, {
            ...options,
            subtitlesOffset: status.media.options.originalSubtitlesOffset
        }, offset );

        await this.sessions.update( id, {
            ...options,
            subtitlesOffset: offset
        } );

        if ( index === null ) {
            status = await this.pause();

            return this.play( id, { startTime: status.media.time.current - this.config.subtitles.delay.rollback } );
        } else {
            return this.changeSubtitles( index );
        }
    }

    async increaseSubtitlesOffset ( offset : number = null ) {
        if ( typeof offset !== 'number' ) {
            offset = 250;
        }

        return this.setSubtitlesOffset( ( await this.getSubtitlesOffset() ) + offset );
    }

    async decreaseSubtitlesOffset ( offset : number = null ) {
        if ( typeof offset !== 'number' ) {
            offset = 250;
        }

        return this.setSubtitlesOffset( ( await this.getSubtitlesOffset() ) - offset );
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

export class ChromecastSubtitlesStyles {
    defaultStyles : any;

    customStyles : any[];

    customStyleIndex : number;
    
    fontScale : number = 1;

    style : any;

    constructor ( defaultStyles : any, customStyles : any[] = [] ) {
        this.defaultStyles = defaultStyles;

        this.customStyles = customStyles;

        this.customStyleIndex = 0;

        this.fontScale = this.defaultStyles.fontScale || 1;

        this.cacheStyle();
    }

    setFontScale ( scale : number ) : this {
        if ( scale != this.fontScale ) {
            this.fontScale = scale;

            this.cacheStyle();
        }

        return this;
    }

    setCustomStyleIndex ( index : number ) : this {
        if ( index != this.customStyleIndex ) {
            this.customStyleIndex = index;

            this.cacheStyle();
        }

        return this;
    }

    cycleCustomStyles () : this {
        if ( this.customStyles.length > 0 ) {
            this.setCustomStyleIndex( ( this.customStyleIndex + 1 ) % this.customStyles.length );
        }

        return this;
    }

    protected cacheStyle () {
        let temp = { ...this.defaultStyles, fontScale: this.fontScale };

        if ( this.customStyles.length > this.customStyleIndex ) {
            temp = { ...temp, ...this.customStyles[ this.customStyleIndex ] };
        }

        this.style = temp;
    }
}