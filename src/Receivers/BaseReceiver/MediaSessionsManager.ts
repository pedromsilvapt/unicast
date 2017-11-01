import { MediaPlayOptions, IMediaReceiver } from "./IMediaReceiver";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, PlayableMediaRecord } from "../../MediaRecord";
import { Database, HistoryRecord } from "../../Database";
import { ProvidersManager } from "../../MediaProviders/ProvidersManager";
import { MediaManager } from "../../UnicastServer";
import { CancelToken } from "../../ES2017/CancelToken";

export class MediaSessionsManager {
    protected records : Map<string, Promise<[MediaStream[], MediaRecord, MediaPlayOptions, CancelToken]>> = new Map;

    receiver : IMediaReceiver;

    mediaManager : MediaManager;

    current : string = null;

    constructor ( receiver : IMediaReceiver, media : MediaManager ) {
        this.receiver = receiver;

        this.mediaManager = media;
    }

    async register ( record : MediaRecord, options : MediaPlayOptions = {} ) : Promise<string> {
        const history = await this.mediaManager.database.tables.history.create( {
            playlist: options.playlistId,
            playlistPosition: options.playlistPosition,
            reference: { id: record.id, kind: record.kind  },
            position: options.startTime || 0,
            receiver: this.receiver.name,
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
        console.log( id, this.records.has( id ) );

        if ( this.records.has( id ) ) {
            ( await this.records.get( id ) )[ 3 ].cancel();
            
            // this.records.delete( id )
        }
    }
}