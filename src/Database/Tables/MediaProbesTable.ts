import { MediaKind, MediaRecord } from '../../MediaRecord';
import { MediaProbe } from '../../MediaTools';
import { Converters, FieldConverters } from '../Converters';
import { BaseTable, DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { BaseRecord, BaseRecordSql, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class MediaProbesTable extends BaseTable<MediaProbeRecord> {
    tableName : string = 'mediaProbes';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        record: BelongsToOnePolyRelation<MediaProbeRecord, MediaRecord>;
    }

    fieldConverters: FieldConverters<MediaProbeRecord, MediaProbeRecordSql> = {
        id: Converters.id(),
        mediaId: Converters.id(),
        metadata: Converters.json(),
        raw: Converters.json(),
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

export interface MediaProbeRecord extends BaseRecord, TimestampedRecord {
    mediaId : string;
    mediaKind : MediaKind;
    metadata : MediaProbe;
    raw : any;

    record ?: MediaRecord;
}

export interface MediaProbeRecordSql extends BaseRecordSql, TimestampedRecordSql {
    mediaId : number;
    metadata : string;
    raw : string;
}
