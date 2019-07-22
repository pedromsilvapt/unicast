import { BaseReceiver } from '../../../Receivers/BaseReceiver/BaseReceiver';
import { MediaPlayOptions, ReceiverStatus, ReceiverStatusState } from '../../../Receivers/BaseReceiver/IMediaReceiver';
import { MpvConnection } from './MpvConnection';
import { UnicastServer } from '../../../UnicastServer';
import { Synchronized } from 'data-semaphore';
import { Logger } from 'clui-logger';
import { VideoMediaStream } from '../../../MediaProviders/MediaStreams/VideoStream';
import { MediaStreamType, MediaStream } from '../../../MediaProviders/MediaStreams/MediaStream';
import { HttpSender } from '../../../Receivers/BaseReceiver/HttpSender';
import { SubtitlesMediaStream } from '../../../MediaProviders/MediaStreams/SubtitlesStream';
import { InvalidArgumentError } from 'restify-errors';
import { UnicastMpv } from 'unicast-mpv';
import { Config } from '../../../Config';
import { MpvHlsTranscoder } from './MpvHlsTranscoder';
import { isTvEpisodeRecord, isMovieRecord, MediaKind, MediaRecord } from '../../../MediaRecord';
import { LoadOptions } from 'unicast-mpv/lib/Player';
import * as objectPath from 'object-path';
import { MpvHttpSender } from './MpvHttpSender';

export interface MpvConfig {
    config ?: any;
    subtitles ?: MpvSubtitlesConfig;
}

export interface MpvSubtitlesConfig {
    lineFilters ?: (string | RegExp)[]
    delay: {
        duration : number;
        rollback : number;
    }
}

export class MpvReceiver extends BaseReceiver {
    readonly type : string = 'mpv';

    readonly address : string;
    
    readonly port : number;

    protected connection : MpvConnection = null;

    protected instance : UnicastMpv = null;

    sender : HttpSender;
    
    config : MpvConfig;

    logger : Logger;

    constructor ( server : UnicastServer, name : string, address : string, port : number, config : MpvConfig = {} ) {
        super( server, name );

        this.config = config;

        this.sender = new MpvHttpSender( this );

        this.logger = this.server.logger.service( `Receivers/${ this.type }/${ this.name }` );

        // this.transcoder = new MpvHlsTranscoder( this );

        this.port = port;

        if ( address == 'builtin' ) {
            this.instance = new UnicastMpv( Config.merge( [
                UnicastMpv.baseConfig(),
                Config.create( config.config || {} ),
                Config.create( {
                    server: {
                        address: 'localhost',
                        port: port
                    }
                } )
            ] ), this.logger );

            this.address = 'localhost';

            this.instance.listen()
                .catch( error => this.logger.error( error ) );
        } else {
            this.address = address;
        }

        this.connection = new MpvConnection( this.address, this.port );
    }

    get connected () : boolean {
        return this.connection != null;
    }

    @Synchronized()
    async connect () : Promise<boolean> {
        if ( this.connection.connected ) {
            await this.connection.open();
        }

        return true;
    }

    async disconnect () : Promise<boolean> {
        if ( this.connection != null ) {
            this.connection.close();
        }

        return Promise.resolve( true );
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
            await this.connection.quit();
        } catch ( err ) {
            this.logger.error( err.message, err );
        }

        if ( this.sessions.current ) {
            this.sessions.release( this.sessions.current );
        }

        return this.status();
    }

    protected getStreamUrl ( session : string, stream : MediaStream ) : string {
        return this.sender.host() + this.sender.getUrlFor( session, stream.id );
    }

    protected async getRecordTitle ( record : MediaRecord ) : Promise<string> {
        if ( isTvEpisodeRecord( record ) ) {
            const season = await this.sender.receiver.server.media.get( MediaKind.TvSeason, record.tvSeasonId );

            const show = await this.sender.receiver.server.media.get( MediaKind.TvShow, season.tvShowId );

            return `${ show.title } - Season ${record.seasonNumber} Episode ${ record.number } "${record.title}"`;
        } else if ( isMovieRecord( record ) ) {
            return `${ record.title } (${ record.year })`
        } else {
            return record.title;
        }
    }

    async play ( id : string, customOptions ?: MediaPlayOptions): Promise<ReceiverStatus> {
        // Get the session information
        const { streams, record, options: recordPlayOptions } = await this.sessions.get( id );

        // Find the video stream
        const video : VideoMediaStream = streams.find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;
        const subtitles : SubtitlesMediaStream = streams.find( stream => stream.type === MediaStreamType.Subtitles ) as SubtitlesMediaStream;

        const playOptions : MediaPlayOptions = { ...recordPlayOptions, ...customOptions };

        try {
            if ( !video ) {
                throw new Error( `Trying to play media with no video stream is not currently supported.` );
            }
    
            const title = await this.getRecordTitle( record );

            const options : LoadOptions = {
                pause: typeof playOptions.autostart === 'boolean' ? !playOptions.autostart : false,
                start: Math.max( playOptions.startTime, 0 ),
                title: title,
                mediaTitle: title
            };

            if ( this.sessions.current != null && this.sessions.current != id ) {
                await this.sessions.release( this.sessions.current );
            }
        
            const videoUrl = this.getStreamUrl( id, video );
            const subtitlesUrl = subtitles ? this.getStreamUrl( id, subtitles ) : null;

            await this.connection.play( videoUrl, subtitlesUrl, options );
    
            this.sessions.current = id;
    
            this.emit( 'play', id );
        } catch ( err ) {
            this.sessions.release( id );

            if ( this.sessions.current == id ) this.sessions.current = null;

            throw err;
        }

        return this.status();
    }

    async pause () : Promise<ReceiverStatus> {
        await this.connection.pause();

        this.emit( 'pause', this.sessions.current );
        
        await this.connection.showProgress();

        return this.status();
    }

    async resume () : Promise<ReceiverStatus> {
        await this.connection.resume();

        this.emit( 'resume', this.sessions.current );

        await this.connection.showProgress();

        return this.status();
    }

    async stop () : Promise<ReceiverStatus> {
        await this.connection.stop();

        await this.sessions.release( this.sessions.current );

        const id = this.sessions.current;

        this.sessions.current = null;
        
        this.emit( 'stop', id );

        return this.status();
    }

    async status () : Promise<ReceiverStatus> {
        const status = await this.connection.status().catch( err => {
            if ( err && ( err.errno == 'ETIMEDOUT' || err.errno == 'ECONNREFUSED' ) ) {
                return null;
            }

            return Promise.reject( err );
        } );

        if ( !status || !status.path ) {
            return {
                timestamp: new Date(),
                online: status != null,
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

        const session = this.sessions.current;
        
        const { record, options } = await this.sessions.get( session );

        const normalized : ReceiverStatus = {
            timestamp: new Date(),
            online: true,
            state: status.pause ? ReceiverStatusState.Paused : ReceiverStatusState.Playing,
            media: {
                time: { 
                    duration: status.duration, 
                    current: status.position, 
                    speed: status.pause ? 0 : 1
                },
                transcoding: null,
                record: record,
                session: await this.server.database.tables.history.get( session ),
                options: options
            },
            volume: { level: Math.round( status.volume ), muted: status.mute },
            subtitlesStyle: {
                size: status.subScale
            }
        };

        return normalized;
    }

    async seek ( time : number ) : Promise<ReceiverStatus> {
        await this.connection.seek( time );

        await this.connection.showProgress();

        return this.status();
    }

    async seekTo ( time : number ) : Promise<ReceiverStatus> {
        await this.connection.goToPosition( time );

        await this.connection.showProgress();

        return this.status();
    }

    async mute () : Promise<ReceiverStatus> {
        await this.connection.mute();

        return this.status();
    }

    async unmute () : Promise<ReceiverStatus> {
        await this.connection.unmute();

        return this.status();
    }

    async setVolume ( level : number ) : Promise<ReceiverStatus> {
        await this.connection.volume( level );

        return this.status();
    }

    async callCommand<R = any, A extends any[] = any[]> ( commandName : string, args : A ) : Promise<R> {
        if ( commandName in this ) {
            return this[ commandName ]( ...args );
        }

        throw new InvalidArgumentError();
    }

    async setSubtitlesOffset ( offset : number ) {
        let status = await this.status();

        const id = this.sessions.current;
        
        const { options, record } = await this.sessions.get( id );
        
        this.server.rcHistory.add( id, record, status.media.time.current, 'setSubtitlesOffset', [ offset ] );

        await this.sessions.update( id, {
            ...options,
            subtitlesOffset: offset
        } );

        await this.connection.adjustSubtitleTiming( offset / 1000 );

        return this.status();
    }
    
    async getSubtitlesOffset () : Promise<number> {
        if ( !this.sessions.current ) {
            return 0;
        }
        
        const { options } = await this.sessions.get( this.sessions.current );
        
        return options.subtitlesOffset || 0;
    }

    async increaseSubtitlesOffset ( offset : number = null ) {
        if ( typeof offset !== 'number' ) {
            offset = objectPath.get( this.config, 'subtitles.delay.duration', 250 );
        }

        return this.setSubtitlesOffset( ( await this.getSubtitlesOffset() ) + offset );
    }

    async decreaseSubtitlesOffset ( offset : number = null ) {
        if ( typeof offset !== 'number' ) {
            offset = objectPath.get( this.config, 'subtitles.delay.duration', 250 );
        }

        return this.setSubtitlesOffset( ( await this.getSubtitlesOffset() ) - offset );
    }

    async changeSubtitles ( index : number ) : Promise<ReceiverStatus> {
        // await this.client.changeSubtitles( index );

        return this.status();
    }

    async changeSubtitlesSize ( size : number ) : Promise<ReceiverStatus> {
        await this.connection.subtitleScale( size );
        // await this.client.changeSubtitlesStyle( this.subtitlesStyle.setFontScale( size ).style );

        return this.status();
    }

    async changeSubtitlesStyle ( index : number ) : Promise<ReceiverStatus> {
        // TODO Implement subtitle styles 
        // await this.client.changeSubtitlesStyle( this.subtitlesStyle.setCustomStyleIndex( index ).style );

        return this.status();
    }

    async cycleSubtitlesStyle () : Promise<ReceiverStatus> {
        // await this.client.changeSubtitlesStyle( this.subtitlesStyle.cycleCustomStyles().style );

        return this.status();
    }

    toJSON () {
        return {
            type: this.type,
            name: this.name,
            address: this.address,
            port: this.port
        };
    }
}