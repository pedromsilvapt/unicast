import { BaseTable } from './BaseTable';
import { MediaKind } from './AbstractMediaTable';
import { Converters, FieldConverters } from '../Converters';

export class MediaTable extends BaseTable<{ id?: string; kind: MediaKind }> {
    readonly tableName : string = 'media';
    
    fieldConverters: FieldConverters<GlobalMediaRecord, GlobalMediaRecordSql> = {
        id: Converters.id(),
    };
}

export interface GlobalMediaRecord { 
    id?: string; 
    kind: MediaKind 
}

export interface GlobalMediaRecordSql {
    id : number;
}
