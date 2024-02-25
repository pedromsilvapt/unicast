import { Converters, FieldConverters } from '../Converters';
import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class JobsQueueTable extends BaseTable<JobRecord> {
    tableName : string = 'jobQueue';
    
    fieldConverters: FieldConverters<JobRecord, JobRecordSql> = {
        id: Converters.id(),
        payload: Converters.json(),
        nextAttempt: Converters.date(),
        updatedAt: Converters.date(),
        createdAt: Converters.date(),
        attemptedAt: Converters.date(),
    };

}

export interface JobRecord<P = any> extends BaseRecord, TimestampedRecord {
    action : string;
    payload : P;
    priority : number;

    pastAttempts : number;
    maxAttempts : number;
    nextAttempt : Date;

    attemptedAt : Date;
}

export interface JobRecordSql extends BaseRecordSql, TimestampedRecordSql {
    payload : string;
    nextAttempt : number;
    attemptedAt : number;
}
