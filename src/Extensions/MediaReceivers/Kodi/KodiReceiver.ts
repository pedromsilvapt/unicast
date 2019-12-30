import { BaseReceiver, ReceiverSubtitlesStyles } from '../../../Receivers/BaseReceiver/BaseReceiver';
import { MediaPlayOptions, ReceiverStatus, ReceiverStatusState } from '../../../Receivers/BaseReceiver/IMediaReceiver';
import { KodiConnection } from './KodiConnection';
import { UnicastServer } from '../../../UnicastServer';
import { Synchronized } from 'data-semaphore';
import { Logger } from 'clui-logger';
import { VideoMediaStream } from '../../../MediaProviders/MediaStreams/VideoStream';
import { MediaStreamType, MediaStream } from '../../../MediaProviders/MediaStreams/MediaStream';
import { HttpSender } from '../../../Receivers/BaseReceiver/HttpSender';
import { SubtitlesMediaStream } from '../../../MediaProviders/MediaStreams/SubtitlesStream';
import { InvalidArgumentError } from 'restify-errors';
import { isTvEpisodeRecord, isMovieRecord, MediaKind, MediaRecord, isPlayableRecord } from '../../../MediaRecord';
import { LoadOptions } from 'unicast-mpv/lib/Player';
import * as objectPath from 'object-path';
import { KodiHttpSender } from './KodiHttpSender';
import { MediaTrigger } from '../../../TriggerDb';
import { KodiFFmpegDriver } from './KodiFFmpegDriver';
  
// create a client
export interface KodiConfig {
    username ?: string;
    password ?: string;
    subtitles ?: KodiSubtitlesConfig;
}

export interface KodiSubtitlesConfig {
    lineFilters ?: (string | RegExp)[]
    style ?: {
        custom ?: any;
        default ?: any[];
    }
}

interface SubtitleConfigProperties {
    subFixTiming ?: boolean;
    subVisibility ?: boolean;
    subFontSize ?: number;
    subBackColor ?: string;
    subBold ?: boolean;
    subItalic ?: boolean;
    subBorderSize ?: number;
    subColor ?: string;
    subMarginX ?: number;
    subMarginY ?: number;
    subAlignX ?: 'left' | 'center' | 'right';
    subAlignY ?: 'top' | 'center' | 'bottom';
    subJustify ?: 'auto' | 'left' | 'center' | 'right';
    subShadowOffset ?: number;
    subShadowColor ?: string;
    subSpacing ?: number;
}

export class KodiReceiver extends BaseReceiver {
    readonly type : string = 'kodi';

    readonly address : string;
    
    readonly port : number;

    protected connection : KodiConnection = null;

    subtitlesStyle : KodiSubtitlesStyles;
    
    sender : HttpSender;
    
    config : KodiConfig;

    logger : Logger;

    constructor ( server : UnicastServer, name : string, address : string, port : number, config : KodiConfig = {} ) {
        super( server, name );

        this.config = config;

        this.sender = new KodiHttpSender( this );

        this.logger = this.server.logger.service( `Receivers/${ this.type }/${ this.name }` );

        this.subtitlesStyle = new KodiSubtitlesStyles( {
            ...this.getDefaultSubtitlesStyle(),
            ...this.config.subtitles.style.default,
        }, this.config.subtitles.style.custom || [ {
            subBackColor: '0.0/0.0/0.0/0.0',
        }, {
            subBackColor: '0.0/0.0/0.0/0.33',
            subShadowOffset: 5
        }, {
            subBackColor: '0.0/0.0/0.0/0.66',
            subShadowOffset: 5
        } ] );

        this.port = port;

        this.address = address;

        this.connection = new KodiConnection( this.address, this.port, config.username, config.password );
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

    getDefaultSubtitlesStyle () : SubtitleConfigProperties {
        return {
            subBackColor: '0.0/0.0/0.0/0.0'
        };
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
        const playOptions : MediaPlayOptions = { ...recordPlayOptions, ...customOptions };

        if ( !isPlayableRecord( record ) ) {
            throw new Error( `Can't play record of type ${ record.kind }.` );
        }

        try {
            const options : LoadOptions = {
                pause: typeof playOptions.autostart === 'boolean' ? !playOptions.autostart : false,
                start: Math.max( playOptions.startTime, 0 )
            };

            if ( this.sessions.current != null && this.sessions.current != id ) {
                await this.sessions.release( this.sessions.current );
            }
        
            await this.connection.play( record, {
                options,
                ...this.subtitlesStyle.currentStyle
            } );
    
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
            const codes = [ 'ETIMEDOUT', 'ECONNREFUSED' ];

            for ( let code of codes ) {
                if ( err && ( err.errno == code || ( err.message && err.message.includes( code ) ) ) ) {
                    return null;
                }
            }

            return Promise.reject( err );
        } );

        
        const session = this.sessions.current;

        if ( !status || !session ) {
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


        const { record, options } = await this.sessions.get( session );

        const normalized : ReceiverStatus = {
            timestamp: new Date(),
            online: true,
            state: status.pause ? ReceiverStatusState.Paused : ReceiverStatusState.Playing,
            media: {
                time: { 
                    duration: status.totalTime, 
                    current: status.time, 
                    speed: status.pause ? 0 : status.speed
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
        await this.connection.seekRelative( time );

        await this.connection.showProgress();

        return this.status();
    }

    async seekTo ( time : number ) : Promise<ReceiverStatus> {
        await this.connection.seek( time );

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
    
    async getSubtitlesOffset () : Promise<number> {
        if ( !this.sessions.current ) {
            return 0;
        }
        
        const { options } = await this.sessions.get( this.sessions.current );
        
        return options.subtitlesOffset || 0;
    }

    async increaseSubtitlesOffset () {
        await this.connection.subtitleDelayPlus();

        return this.status();
    }

    async decreaseSubtitlesOffset () {
        await this.connection.subtitleDelayMinus();

        return this.status();
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
        await this.connection.setMultipleProperties ( this.subtitlesStyle.setCustomStyleIndex( index ).currentStyle );


        return this.status();
    }

    async cycleSubtitlesStyle () : Promise<ReceiverStatus> {
        await this.connection.setMultipleProperties ( this.subtitlesStyle.cycleCustomStyles().currentStyle );

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

export class KodiSubtitlesStyles extends ReceiverSubtitlesStyles<SubtitleConfigProperties> { }