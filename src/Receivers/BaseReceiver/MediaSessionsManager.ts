import { MediaPlayOptions, IMediaReceiver, ReceiverStatusState, ReceiverStatus } from "./IMediaReceiver";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, PlayableMediaRecord } from "../../MediaRecord";
import { MediaManager } from "../../UnicastServer";
import { CancelToken } from "../../ES2017/CancelToken";
import { EventEmitter } from "events";

export class MediaSessionsManager {
    protected records : Map<string, Promise<[MediaStream[], MediaRecord, MediaPlayOptions, CancelToken]>> = new Map;

    receiver : IMediaReceiver;

    mediaManager : MediaManager;

    current : string = null;

    statusPoller : PriorityPoller;

    constructor ( receiver : IMediaReceiver, media : MediaManager ) {
        this.receiver = receiver;

        this.mediaManager = media;

        this.statusPoller = new PriorityPoller( async poller => {
            const status = await this.receiver.status();

            if ( status && ( status.state == ReceiverStatusState.Playing
                || status.state == ReceiverStatusState.Buffering
                || status.state == ReceiverStatusState.Paused ) ) {

                poller.currentPriority = 0;
            } else {
                poller.currentPriority = 1;
            }

            await this.updateStatus( status );
        }, [ 5 * 1000, 60 * 1000 ], 1 );

        this.receiver.on( 'pause', () => this.statusPoller.currentPriority = 1 );
        this.receiver.on( 'stop', () => this.statusPoller.currentPriority = 1 );

        this.receiver.on( 'resume', () => this.statusPoller.currentPriority = 0 );
        this.receiver.on( 'play', () => this.statusPoller.currentPriority = 0 );
    }

    async updateStatus ( status : ReceiverStatus ) {
        if ( status && status.session ) {
            const id = status.session;
    
            const history = await this.mediaManager.database.tables.history.get( id );
    
            if ( history ) {
                history.position = status.media.time.current;
        
                const lastIndex = history.positionHistory.length - 1;

                const last = history.positionHistory[ lastIndex ];

                if ( Math.abs( history.position - last ) <= 60 ) {
                    history.positionHistory[ lastIndex ] = history.position;
                } else {
                    history.positionHistory.push( history.position );
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
            positionHistory: [ options.startTime || 0 ],
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