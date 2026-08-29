import {MediaKind, MediaRecord, PlayableMediaRecord} from '../../MediaRecord';
import { MediaSourceDetails } from '../../MediaProviders/MediaSource';
import { Converters, FieldConverters } from '../Converters';
import { BaseTable, DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { BaseRecord, BaseRecordSql, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export type MediaSourceCacheState = 'queued' | 'copying' | 'ready' | 'failed' | 'paused';

export class MediaSourcesCacheTable extends BaseTable<MediaSourceCacheRecord> {
    tableName : string = 'mediaSourcesCache';

    dateFields = [ 'createdAt', 'updatedAt', 'lastAttemptAt' ];

    declare relations: {
        record: BelongsToOnePolyRelation<MediaSourceCacheRecord, PlayableMediaRecord, { record: PlayableMediaRecord }>;
    }

    fieldConverters: FieldConverters<MediaSourceCacheRecord, MediaSourceCacheRecordSql> = {
        id: Converters.id(),
        mediaId: Converters.id(),
        sources: Converters.json<MediaSourceDetails[]>(),
        lastAttemptAt: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'mediaKind', 'mediaId' ),
        };
    }
}

export interface MediaSourceCacheRecord extends BaseRecord, TimestampedRecord {
    mediaId : string;
    mediaKind : MediaKind;
    state : MediaSourceCacheState;
    sources : MediaSourceDetails[] | null;
    error : string | null;
    lastAttemptAt : Date | null;
}

export interface MediaSourceCacheRecordSql extends BaseRecordSql, TimestampedRecordSql {
    mediaId : number;
    sources : string;
    lastAttemptAt : number;
}
