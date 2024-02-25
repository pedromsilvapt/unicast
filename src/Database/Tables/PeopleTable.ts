import { MediaCastRecord, MediaRecord, MediaRecordArt } from '../../MediaRecord';
import { Converters, FieldConverters } from '../Converters';
import { BaseTable, DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { ManyToManyPolyRelation } from '../Relations/ManyToManyPolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { BaseRecord, BaseRecordSql, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class PeopleTable extends BaseTable<PersonRecord> {
    tableName : string = 'people';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        credits: ManyToManyPolyRelation<PersonRecord, MediaRecord>;
    };

    fieldConverters: FieldConverters<PersonRecord, PersonRecordSql> = {
        id: Converters.id(),
        art: Converters.json(),
        birthday: Converters.date(),
        deathday: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };

    identifierFields: string[] = [ 'name' ];

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            credits: new ManyToManyPolyRelation( 'credits', map, tables.mediaCast, 'personId', 'mediaKind', 'mediaId' ).savePivot( 'role' ),
        };
    }
}

export interface PersonRecord extends BaseRecord, TimestampedRecord {
    name : string;
    art : MediaRecordArt;
    biography ?: string;
    birthday ?: Date;
    deathday ?: Date;
    naturalFrom ?: string;

    // Foreign Relation
    cast ?: MediaCastRecord;
}

export interface PersonRecordSql extends BaseRecordSql, TimestampedRecordSql {
    art : string;
    birthday ?: number;
    deathday ?: number;
}
