import { MediaPlayOptions, IMediaReceiver, ReceiverStatusState, ReceiverStatus } from "./IMediaReceiver";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, PlayableMediaRecord, MediaKind, TvEpisodeMediaRecord } from "../../MediaRecord";
import { MediaManager } from "../../UnicastServer";
import { CancelToken } from "../../ES2017/CancelToken";
import { EventEmitter } from "events";
import { HistoryRecord } from "../../Database";
import { Optional } from 'data-optional';
import * as sortBy from 'sort-by';
import { TranscodingBackgroundTask } from "../../Transcoding/TranscodingDriver";

export class MediaSessionsManager {
    protected records : Map<string, Promise<[MediaStream[], MediaRecord, MediaPlayOptions, CancelToken]>> = new Map;

    receiver : IMediaReceiver;

    mediaManager : MediaManager;

    current : string = null;

    statusPoller : PriorityPoller;

    zapping : Map<string, IZappingStrategy> = new Map();

    constructor ( receiver : IMediaReceiver, media : MediaManager ) {
        this.receiver = receiver;

        this.mediaManager = media;

        this.zapping.set( 'auto', new AutoZappingStrategy() );
        this.zapping.set( 'playlist', new PlaylistZappingStrategy() );
        this.zapping.set( 'tvshow', new TvShowZappingStrategy() );

        this.statusPoller = new PriorityPoller( async poller => {
            const status = await this.receiver.status();

            if ( status && ( status.state == ReceiverStatusState.Playing
                || status.state == ReceiverStatusState.Buffering
                || status.state == ReceiverStatusState.Paused ) ) {

                poller.currentPriority = 0;
            } else {
                poller.currentPriority = 1;
            }

            try {
                await this.updateStatus( status );
            } catch ( err ) {
                this.mediaManager.server.onError.notify( err );
            }
        }, [ 5 * 1000, 60 * 1000 ], 1 );

        this.receiver.on( 'pause', () => this.statusPoller.currentPriority = 1 );
        this.receiver.on( 'stop', () => this.statusPoller.currentPriority = 1 );

        this.receiver.on( 'resume', () => this.statusPoller.currentPriority = 0 );
        this.receiver.on( 'play', () => this.statusPoller.currentPriority = 0 );

        this.statusPoller.pause();
    }

    getSessionPercentage ( history : HistoryRecord, status : ReceiverStatus ) : number {
        return history.positionHistory.map( seg => seg.end - seg.start ).reduce( ( a, b ) => a + b, 0 ) * status.media.time.duration / 100;
    }

    async updateStatus ( status : ReceiverStatus ) {
        if ( status && status.media && status.media.session ) {
            const id = status.media.session.id;
    
            const history = await this.mediaManager.database.tables.history.get( id );
    
            if ( history ) {
                history.position = status.media.time.current;
        
                const lastIndex = history.positionHistory.length - 1;

                const last = history.positionHistory[ lastIndex ];

                if ( Math.abs( history.position - last.end ) <= 60 ) {
                    history.positionHistory[ lastIndex ].end = history.position;
                } else {
                    history.positionHistory.push( { start: history.position, end: history.position } );
                }

                console.log( history.watched, this.getSessionPercentage( history, status ) );
                if ( !history.watched && this.getSessionPercentage( history, status ) >= 85 ) {
                    const media = await this.mediaManager.get( history.reference.kind, history.reference.id );
                    
                    await this.mediaManager.watchTracker.watch( media );
                }
                
                history.updatedAt = new Date();
        
                await this.mediaManager.database.tables.history.update( id, history );
            }
        }
    }

    async register ( record : MediaRecord, options : MediaPlayOptions = {} ) : Promise<string> {
        const history = await this.mediaManager.database.tables.history.create( {
            playlist: options.playlistId,
            playlistPosition: options.playlistPosition,
            reference: { id: record.id, kind: record.kind  },
            position: options.startTime || 0,
            receiver: this.receiver.name,
            positionHistory: [ { start: options.startTime || 0, end: options.startTime || 0 } ],
            watched: false,
            createdAt: new Date(),
            updatedAt: new Date()
        } );

        return history.id;
    }

    async has ( id : string ) : Promise<boolean> {
        return this.records.has( id ) || await this.mediaManager.database.tables.history.has( id );
    }

    async getRaw ( id : string ) : Promise<[ MediaStream[], MediaRecord, MediaPlayOptions, CancelToken ]> {
        const history = await this.mediaManager.database.tables.history.get( id );
        
        if ( history ) {
            const cancel = new CancelToken();

            const media = await this.mediaManager.get( history.reference.kind, history.reference.id ) as PlayableMediaRecord;
            
            const originalStreams = await this.mediaManager.providers.streams( media.sources );
            
            const streams = await this.receiver.transcoder.transcode( history, media, originalStreams, {}, cancel );
            
            cancel.whenCancelled().then( () => {
                for ( let stream of streams ) {
                    stream.close();
                }
            } );

            const options : MediaPlayOptions = {
                autostart: true,
                startTime: history.position,
                mediaId: media.id,
                mediaKind: media.kind
            };

            return [ streams, media, options, cancel ];
        }

        return null;
    }

    async getNext ( id : string, strategy : string = 'auto' ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        if ( !id ) {
            return Optional.empty();
        }

        if ( !this.zapping.has( strategy ) ) {
            throw new Error( `Zapping strategy ${ strategy } not defined.` );
        }

        const session = await this.mediaManager.database.tables.history.get( id );
                
        return this.zapping.get( strategy ).next( session, this );
    }

    async getPrevious ( id : string, strategy : string = 'auto' ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        if ( !id ) {
            return Optional.empty();
        }

        if ( !this.zapping.has( strategy ) ) {
            throw new Error( `Zapping strategy ${ strategy } not defined.` );
        }
        
        const session = await this.mediaManager.database.tables.history.get( id );
                
        return this.zapping.get( strategy ).previous( session, this );
    }

    async get ( id : string ) : Promise<[ MediaStream[], MediaRecord, MediaPlayOptions, CancelToken ]> {
        if ( !this.records.has( id ) ) {
            this.records.set( id, this.getRaw( id ) );
        }

        return await this.records.get( id );
    }

    async release ( id : string ) {
        if ( this.records.has( id ) ) {
            const [ streams, record, options, cancel ] = await this.records.get( id );

            cancel.cancel();
        }
    }
}

/**
 * Receives a list of number intervals in milliseconds, and runs the callback with each interval.
 * The interval duration currently in use can be switched at any time.
 * 
 * @export
 * @class PriorityPoller
 * @extends {EventEmitter}
 */
export class PriorityPoller extends EventEmitter {
    protected intervalTimer : NodeJS.Timer = null;

    priorities : number[];

    isPolling : boolean = false;

    isPaused : boolean = false;

    protected _currentPriority;

    protected onPollCallback : ( poller : PriorityPoller ) => void | Promise<void>;

    get currentPriority () : number {
        return this._currentPriority;
    }

    set currentPriority ( value : number ) {
        if ( value != this._currentPriority ) {
            this._currentPriority = value;

            if ( this.intervalTimer ) {
                clearTimeout( this.intervalTimer );
            }

            if ( !this.isPaused ) {
                this.setupInterval();
            }
        }
    }

    constructor ( callback : ( poller : PriorityPoller ) => void | Promise<void>, priorities : number[], currentPriority : number = 0 ) {
        super();

        this.onPollCallback = callback;
        this.priorities = priorities;
        this.currentPriority = currentPriority;
    }

    protected setupInterval () {
        if ( this.intervalTimer ) {
            clearTimeout( this.intervalTimer );
        }
        
        if ( !this.isPolling ) {
            const interval = this.priorities[ this.currentPriority ];

            if ( typeof interval === 'number' && interval != Infinity ) {
                this.intervalTimer = setTimeout( this.onPoll.bind( this ), interval );
            }
        }
    }

    onPoll () {
        process.nextTick( async () => {
            if ( this.isPolling ) {
                return;
            }

            if ( this.onPollCallback ) {
                try {
                    this.intervalTimer = null;
    
                    this.isPolling = true;
    
                    await Promise.resolve( this.onPollCallback( this ) );
                } catch ( error ) {
                    this.emit( 'error', error );
                } finally {
                    this.isPolling = false;
    
                    if ( !this.isPaused ) {
                        this.setupInterval();
                    }
                }
            }
        } );
    }

    pause () {
        this.isPaused = true;

        if ( this.intervalTimer ) {
            clearTimeout( this.intervalTimer );
        }
    }

    resume () {
        if ( this.isPaused ) {
            this.isPaused = false;

            this.setupInterval();
        }
    }
}

export interface IZappingStrategy {
    applies ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<boolean>;

    next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>>;

    previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>>;
}

export class AutoZappingStrategy implements IZappingStrategy {
    strategies : string[] = [ 'playlist', 'tvshow' ];

    async applies ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<boolean> {
        for ( let strategy of this.strategies ) {
            if ( manager.zapping.has( strategy ) && await manager.zapping.get( strategy ).applies( session, manager ) ) {
                return true;
            }
        }

        return false;
    }

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        for ( let strategy of this.strategies ) {
            if ( manager.zapping.has( strategy ) && await manager.zapping.get( strategy ).applies( session, manager ) ) {
                return manager.zapping.get( strategy ).next( session, manager );
            }
        }

        return Optional.empty();
    }

    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        for ( let strategy of this.strategies ) {
            if ( manager.zapping.has( strategy ) && await manager.zapping.get( strategy ).applies( session, manager ) ) {
                return manager.zapping.get( strategy ).previous( session, manager );
            }
        }

        return Optional.empty();
    }
}
export class PlaylistZappingStrategy implements IZappingStrategy {
    async applies ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<boolean> {
        return session.playlist != null;
    }

    protected async offset ( session : HistoryRecord, manager : MediaSessionsManager, offset : number ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        if ( !session.playlist ) {
            return Optional.empty<[ MediaRecord, MediaPlayOptions ]>();
        }

        const playlist = await manager.mediaManager.database.tables.playlists.get( session.playlist );

        
        const index = session.playlistPosition;

        if ( index + offset < 0 || index + offset >= playlist.references.length ) {
            return Optional.empty();
        }

        const media = await manager.mediaManager.get( playlist.references[ index + offset ].kind, playlist.references[ index + offset ].id );

        if ( !media ) {
            return Optional.empty();
        }

        return Optional.of<[ MediaRecord, MediaPlayOptions ]>( [ media, { playlistId: playlist.id, playlistPosition: index + offset } ] );
    }

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, 1 );
    }
    
    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, -1 );
    }
}

export class TvShowZappingStrategy implements IZappingStrategy {
    async applies ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<boolean> {
        const record = await manager.mediaManager.get( session.reference.kind, session.reference.id );

        return record.kind === MediaKind.TvEpisode;
    }

    protected async offset ( session : HistoryRecord, manager : MediaSessionsManager, offset : number ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        const record = await manager.mediaManager.get( session.reference.kind, session.reference.id ) as TvEpisodeMediaRecord;

        if ( record.kind !== MediaKind.TvEpisode ) {
            return Optional.empty();
        }

        const season = await manager.mediaManager.get( MediaKind.TvSeason, record.tvSeasonId );

        const episodes = await manager.mediaManager.getEpisodes( season.tvShowId );

        episodes.sort( sortBy( 'seasonNumber', 'number' ) );

        const index = episodes.findIndex( ep => ep.id === record.id );

        return Optional.ofNullable( episodes[ index + offset ] ).map<[ MediaRecord, MediaPlayOptions ]>( ep => [ ep, {  } ] );
    }

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, 1 );
    }
    
    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ MediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, -1 );
    }
}