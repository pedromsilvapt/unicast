import { DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { BelongsToOneRelation } from '../Relations/OneToOneRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';
import { MediaKind, MediaRecord } from './AbstractMediaTable';
import type { CollectionRecord } from './CollectionsTable';
import { Converters, FieldConverters } from '../Converters';

export class CollectionMediaTable extends BaseTable<CollectionMediaRecord> {
    readonly tableName : string = 'collectionMedia';

    dateFields = [ 'createdAt' ];

    // indexesSchema : IndexSchema[] = [
    //     { name: 'collectionId' },
    //     { name: 'reference', expression: [ r.row( 'mediaKind' ), r.row( 'mediaId' ) ] }
    // ];

    declare relations: {
        record: BelongsToOnePolyRelation<CollectionMediaRecord, MediaRecord, { record : MediaRecord }>;
        collection: BelongsToOneRelation<CollectionMediaRecord, CollectionRecord, { collection : CollectionRecord }>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'mediaKind', 'mediaId' ),
            collection: new BelongsToOneRelation( 'collection', tables.collections, 'collectionId', 'collectionId' )
        };
    }

    fieldConverters: FieldConverters<CollectionMediaRecord, CollectionMediaRecordSql> = {
        id: Converters.id(),
        collectionId: Converters.id(),
        mediaId: Converters.id(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };

    async repair ( records : string[] = null ) {
        await super.repair( records );
    }
}

export interface CollectionMediaRecord extends BaseRecord, TimestampedRecord {
    collectionId : string;
    mediaKind : MediaKind;
    mediaId : string;
}

export interface CollectionMediaRecordSql extends BaseRecordSql, TimestampedRecordSql {
    id : number;
    collectionId : number;
    mediaId : number;
}
