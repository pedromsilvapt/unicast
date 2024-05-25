import { MediaKind, MediaRecord } from '../../MediaRecord';
import { Converters, FieldConverters } from '../Converters';
import { BaseTable, DatabaseTables, PersonRecord, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { BelongsToOneRelation } from '../Relations/OneToOneRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { EntityRecord, EntityRecordSql } from './BaseTable';

export class MediaCastTable extends BaseTable<MediaCastRecord> {
    tableName : string = 'mediaCast';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        record: BelongsToOnePolyRelation<MediaCastRecord, MediaRecord>;
        person : BelongsToOneRelation<MediaCastRecord, PersonRecord>;
    }
    
    fieldConverters: FieldConverters<MediaCastRecord, MediaCastRecordSql> = {
        id: Converters.id(),
        external: Converters.json(),
        mediaId: Converters.id(),
        personId: Converters.id(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };


    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'kind', 'id' ),
            person: new BelongsToOneRelation( 'person', tables.people, 'personId' )
        };
    }
}

export interface MediaCastRecord extends EntityRecord {
    mediaId : string;
    mediaKind : MediaKind;
    personId : string;
    role : string;
    order : number;
    appearences ?: number;

    person ?: PersonRecord;
    record ?: MediaRecord;
}

export interface MediaCastRecordSql extends EntityRecordSql {
    mediaId : number;
    personId : number;
}
