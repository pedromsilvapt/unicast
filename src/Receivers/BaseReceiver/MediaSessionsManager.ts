import { MediaPlayOptions, IMediaReceiver, ReceiverStatusState, ReceiverStatus } from "./IMediaReceiver";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, PlayableMediaRecord, MediaKind, TvEpisodeMediaRecord } from "../../MediaRecord";
import { MediaManager } from "../../UnicastServer";
import { CancelToken } from 'data-cancel-token';
import { EventEmitter } from "events";
import { HistoryRecord } from "../../Database/Database";
import { Optional } from 'data-optional';
import * as sortBy from 'sort-by';
import { Synchronized } from "data-semaphore";
import { TranscodingSession } from "../../Transcoding/Transcoder";

export interface ActiveMediaSession<O = any> {
    streams : MediaStream[];
    record : MediaRecord;
    options : MediaPlayOptions;
    cancel : CancelToken;
    transcoding ?: TranscodingSession<O>;
}

export class MediaSessionsManager {
    protected records : Map<string, Promise<ActiveMediaSession>> = new Map;

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
            try {
                const status = await this.receiver.status();

                if ( status && !status.online ) {
                    return;
                }

                if ( status && ( status.state == ReceiverStatusState.Playing
                    || status.state == ReceiverStatusState.Buffering
                    || status.state == ReceiverStatusState.Paused ) ) {

                    poller.currentPriority = 0;
                } else {
                    poller.currentPriority = 1;
                }

                await this.updateStatus( status );
            } catch ( err ) {
                this.mediaManager.server.onError.notify( err );
            }
        }, [ 5 * 1000, 60 * 1000 ], 1 );

        this.receiver.on( 'pause', () => this.statusPoller.currentPriority = 1 );
        this.receiver.on( 'stop', () => this.statusPoller.currentPriority = 1 );

        this.receiver.on( 'resume', () => this.statusPoller.currentPriority = 0 );
        this.receiver.on( 'play', () => this.statusPoller.currentPriority = 0 );

        this.statusPoller.resume();
    }

    getSessionPercentage ( history : HistoryRecord, status : ReceiverStatus ) : number {
        return history.positionHistory.map( seg => seg.end - seg.start ).reduce( ( a, b ) => a + b, 0 ) / status.media.time.duration * 100;
    }

    async updateStatus ( status : ReceiverStatus ) {
        if ( status && status.media && status.media.session ) {
            const id = status.media.session.id;

            const history = await this.mediaManager.database.tables.history.get( id );

            if ( history ) {
                let lastIndex = history.positionHistory.length - 1;

                let last = history.positionHistory[ lastIndex ];

                if ( Math.abs( history.position - last.end ) <= 60 ) {
                    history.positionHistory[ lastIndex ].end = history.position;
                } else {
                    history.positionHistory.push( { start: history.position, end: history.position } );

                    lastIndex += 1;

                    last = history.positionHistory[ lastIndex ];
                }

                if ( history.positionHistory.length <= 1 || last.end - last.start > 20 ) {
                    history.position = status.media.time.current;
                }

                if ( !history.watched && this.getSessionPercentage( history, status ) >= 85 ) {
                    await this.watch( history );
                }

                history.updatedAt = new Date();

                await this.mediaManager.database.tables.history.update( id, history );
            }
        }
    }

    async register ( record : PlayableMediaRecord, options : MediaPlayOptions = {} ) : Promise<string> {
        const history = await this.mediaManager.database.tables.history.create( {
            playlistId: options.playlistId,
            playlistPosition: options.playlistPosition,
            mediaId: record.id,
            mediaKind: record.kind,
            mediaTitle: record.title,
            mediaSubTitle: await this.mediaManager.getRecordSubTitle( record ),
            mediaSources: record.sources,
            position: options.startTime || 0,
            receiver: this.receiver.name,
            positionHistory: [ { start: options.startTime || 0, end: options.startTime || 0 } ],
            watched: false,
            transcoding: options.transcoding,
            createdAt: new Date(),
            updatedAt: new Date()
        } );

        return history.id;
    }

    hasActive ( id : string ) : boolean {
        return this.records.has( id );
    }

    async watch ( history : HistoryRecord ) : Promise<void> {
        if ( !history.watched ) {
            history.watched = true;

            await this.mediaManager.database.tables.history.update( history.id, { watched: true } );

            const media = await this.mediaManager.get( history.mediaKind, history.mediaId );

            await this.mediaManager.watchTracker.watch( media );
        }
    }

    async has ( id : string ) : Promise<boolean> {
        return this.hasActive( id ) || await this.mediaManager.database.tables.history.has( id );
    }

    async create ( id : string ) : Promise<ActiveMediaSession> {
        const history = await this.mediaManager.database.tables.history.get( id );

        if ( history ) {
            const cancel = new CancelToken();

            const record = await this.mediaManager.get( history.mediaKind, history.mediaId ) as PlayableMediaRecord;

            const originalStreams = await this.mediaManager.providers.streams( record.sources );

            const transcoding = this.receiver.transcoder ? await this.receiver.transcoder.transcode( history, record, originalStreams, history.transcoding || {}, cancel ) : null;

            const streams = transcoding ? transcoding.outputs : originalStreams;

            cancel.cancellationPromise.then( () => {
                for ( let stream of streams ) {
                    stream.close();
                }
            } );

            const options : MediaPlayOptions = {
                autostart: true,
                startTime: history.position,
                mediaId: record.id,
                mediaKind: record.kind
            };

            return { streams, record, transcoding, options, cancel };
        }

        return null;
    }

    async getNext ( id : string, strategy : string = 'auto' ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        if ( !id ) {
            return Optional.empty();
        }

        if ( !this.zapping.has( strategy ) ) {
            throw new Error( `Zapping strategy ${ strategy } not defined.` );
        }

        const session = await this.mediaManager.database.tables.history.get( id );

        return this.zapping.get( strategy ).next( session, this );
    }

    async getPrevious ( id : string, strategy : string = 'auto' ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        if ( !id ) {
            return Optional.empty();
        }

        if ( !this.zapping.has( strategy ) ) {
            throw new Error( `Zapping strategy ${ strategy } not defined.` );
        }

        const session = await this.mediaManager.database.tables.history.get( id );

        return this.zapping.get( strategy ).previous( session, this );
    }

    async get ( id : string ) : Promise<ActiveMediaSession> {
        if ( !this.records.has( id ) ) {
            this.records.set( id, this.create( id ).catch( err => {
                this.receiver.server.onError.notify( err );

                this.records.delete( id );

                return null;
            } ) );
        }

        return await this.records.get( id );
    }

    async update ( id : string, options : MediaPlayOptions ) {
        if ( this.records.has( id ) ) {
            const record = await this.records.get( id );

            record.options = options;
        }
    }

    @Synchronized()
    async release ( id : string ) {
        if ( this.records.has( id ) ) {
            const { cancel } = await this.records.get( id );

            cancel.cancel();

            this.records.delete( id );
        }
    }

    destroy () {
        this.statusPoller.pause();

        for( let record of this.records.values() ) {
            record.then( ( { cancel } ) => {
                cancel.cancel();
            } );
        }

        this.records.clear();
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

    next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>>;

    previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>>;
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

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        for ( let strategy of this.strategies ) {
            if ( manager.zapping.has( strategy ) && await manager.zapping.get( strategy ).applies( session, manager ) ) {
                return manager.zapping.get( strategy ).next( session, manager );
            }
        }

        return Optional.empty();
    }

    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
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
        return session.playlistId != null;
    }

    protected async offset ( session : HistoryRecord, manager : MediaSessionsManager, offset : number ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        if ( !session.playlistId ) {
            return Optional.empty<[ PlayableMediaRecord, MediaPlayOptions ]>();
        }

        const playlist = await manager.mediaManager.database.tables.playlists.get( session.playlistId );

        const items = await manager.mediaManager.database.tables.playlists.relations.items.load( playlist );

        const index = session.playlistPosition;

        if ( index + offset < 0 || index + offset >= items.length ) {
            return Optional.empty();
        }

        const media = await manager.mediaManager.get( items[ index + offset ].kind, items[ index + offset ].id ) as PlayableMediaRecord;

        if ( !media ) {
            return Optional.empty();
        }

        return Optional.of<[ PlayableMediaRecord, MediaPlayOptions ]>( [ media, { playlistId: playlist.id, playlistPosition: index + offset } ] );
    }

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, 1 );
    }

    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, -1 );
    }
}

export class TvShowZappingStrategy implements IZappingStrategy {
    async applies ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<boolean> {
        const record = await manager.mediaManager.get( session.mediaKind, session.mediaId );

        return record.kind === MediaKind.TvEpisode;
    }

    protected async offset ( session : HistoryRecord, manager : MediaSessionsManager, offset : number ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        const record = await manager.mediaManager.get( session.mediaKind, session.mediaId ) as TvEpisodeMediaRecord;

        if ( record.kind !== MediaKind.TvEpisode ) {
            return Optional.empty();
        }

        const season = await manager.mediaManager.get( MediaKind.TvSeason, record.tvSeasonId );

        const episodes = await manager.mediaManager.getEpisodes( season.tvShowId );

        episodes.sort( sortBy( 'seasonNumber', 'number' ) );

        const index = episodes.findIndex( ep => ep.id === record.id );

        return Optional.ofNullable( episodes[ index + offset ] ).map<[ PlayableMediaRecord, MediaPlayOptions ]>( ep => [ ep, {  } ] );
    }

    async next ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, 1 );
    }

    async previous ( session : HistoryRecord, manager : MediaSessionsManager ) : Promise<Optional<[ PlayableMediaRecord, MediaPlayOptions ]>> {
        return this.offset( session, manager, -1 );
    }
}
