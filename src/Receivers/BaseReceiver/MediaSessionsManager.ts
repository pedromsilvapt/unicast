import { MediaPlayOptions } from "./IMediaReceiver";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, PlayableMediaRecord } from "../../MediaRecord";
import { Database, HistoryRecord } from "../../Database";
import { ProvidersManager } from "../../MediaProviders/ProvidersManager";
import { MediaManager } from "../../UnicastServer";

export class MediaSessionsManager {
    protected records : Map<string, [MediaStream[], MediaRecord, MediaPlayOptions]> = new Map;

    mediaManager : MediaManager;

    constructor ( media : MediaManager ) {
        this.mediaManager = media;
    }

    async register ( receiver : string, record : MediaRecord, options : MediaPlayOptions = {} ) : Promise<string> {
        const history = await this.mediaManager.database.tables.history.create( {
            playlist: options.playlistId,
            playlistPosition: options.playlistPosition,
            reference: { id: record.id, kind: record.kind  },
            position: options.startTime || 0,
            receiver: receiver,
            createdAt: new Date(),
            updatedAt: new Date()
        } );

        return history.id;
    }

    async has ( id : string ) : Promise<boolean> {
        return this.records.has( id ) || await this.mediaManager.database.tables.history.has( id );
    }

    async get ( id : string ) : Promise<[ MediaStream[], MediaRecord, MediaPlayOptions ]> {
        if ( !this.records.has( id ) ) {
            const history = await this.mediaManager.database.tables.history.get( id );

            if ( history ) {
                const media = await this.mediaManager.get( history.reference.kind, history.reference.id ) as PlayableMediaRecord;

                const streams = await this.mediaManager.providers.streams( media.sources );

                const options : MediaPlayOptions = {
                    autostart: true,
                    startTime: history.position,
                    mediaId: media.id,
                    mediaKind: media.kind
                };

                this.records.set( id, [ streams, media, options ] );
            }
        }

        return this.records.get( id );
    }
}