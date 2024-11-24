import { MediaKind, MediaRecord } from '../../MediaRecord';
import { Converters, FieldConverters } from '../Converters';
import { BaseTable, DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { BaseRecord, BaseRecordSql, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class HistoryTable extends BaseTable<HistoryRecord> {
    readonly tableName : string = 'history';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        record: BelongsToOnePolyRelation<HistoryRecord, MediaRecord, { record: MediaRecord }>;
    }

    fieldConverters: FieldConverters<HistoryRecord, HistoryRecordSql> = {
        id: Converters.id(),
        mediaId: Converters.id(),
        playlistId: Converters.id(),
        positionHistory: Converters.json(),
        transcoding: Converters.json(),
        mediaSources: Converters.json(),
        watched: Converters.bool(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'mediaKind', 'mediaId' )
        };
    }
}

export interface HistoryRecord extends BaseRecord, TimestampedRecord {
    mediaId : string;
    mediaKind : MediaKind;
    mediaTitle : string;
    mediaSubTitle ?: string;
    mediaSources ?: any;
    playlistId ?: string;
    playlistPosition ?: number;
    receiver : string;
    position : number;
    positionHistory : { start: number, end: number }[];
    transcoding ?: any;
    importedFrom ?: string;
    watched: boolean;
}

export interface HistoryRecordSql extends BaseRecordSql, TimestampedRecordSql {
    mediaId : number;
    mediaSources : string;
    playlistId ?: number;
    positionHistory: string;
    transcoding: string;
    watched: number;
}
