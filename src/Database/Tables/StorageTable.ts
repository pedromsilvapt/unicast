import { Converters, FieldConverters } from '../Converters';
import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class StorageTable extends BaseTable<StorageRecord> {
    tableName : string = 'storage';

    dateFields = [ 'createdAt', 'updatedAt' ];

    fieldConverters: FieldConverters<StorageRecord, StorageRecordSql> = {
        id: Converters.id(),
        tags: Converters.json(),
        value: Converters.json(),
        updatedAt: Converters.date(),
        createdAt: Converters.date(),
    };
}

export interface StorageRecord<V = any> extends BaseRecord, TimestampedRecord {
    key : string;
    tags : string[];
    value : V;
}

export interface StorageRecordSql extends BaseRecordSql, TimestampedRecordSql {
    tags : string;
    value : string;
}
