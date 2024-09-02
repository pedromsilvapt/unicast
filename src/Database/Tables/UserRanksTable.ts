import { Converters, FieldConverters } from '../Converters';
import { DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { MediaKind, MediaRecord } from './AbstractMediaTable';
import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class UserRanksTable extends BaseTable<UserRankRecord> {
    readonly tableName : string = 'userRanks';

    declare relations: {
        record: BelongsToOnePolyRelation<UserRankRecord, MediaRecord>;
    }

    fieldConverters: FieldConverters<UserRankRecord, UserRankRecordSql> = {
        id: Converters.id(),
        mediaId: Converters.id(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
    };
    
    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'kind', 'id' )
        };
    }
}

export interface UserRankRecord extends BaseRecord, TimestampedRecord {
    list: string;
    mediaId : string;
    mediaKind : MediaKind;
    position: number;
}

export interface UserRankRecordSql extends BaseRecordSql, TimestampedRecordSql {
    mediaId : number;
}
