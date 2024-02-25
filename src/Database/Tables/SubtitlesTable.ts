import { Converters, FieldConverters } from '../Converters';
import { DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { BelongsToOnePolyRelation } from '../Relations/OneToOnePolyRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { MediaKind, MediaRecord } from './AbstractMediaTable';
import { BaseRecord, BaseRecordSql, BaseTable } from './BaseTable';

export class SubtitlesTable extends BaseTable<SubtitleRecord> {
    readonly tableName : string = 'subtitles';

    declare relations: {
        record: BelongsToOnePolyRelation<SubtitleRecord, MediaRecord>;
    }

    fieldConverters: FieldConverters<SubtitleRecord, SubtitleRecordSql> = {
        id: Converters.id(),
        mediaId: Converters.id(),
    };
    
    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'reference.kind', 'reference.id' )
        };
    }
}

export interface SubtitleRecord extends BaseRecord {
    releaseName : string;
    language : string;
    format : string;
    file : string;
    mediaId : string;
    mediaKind : MediaKind;
}

export interface SubtitleRecordSql extends BaseRecordSql {
    mediaId : number;
}
