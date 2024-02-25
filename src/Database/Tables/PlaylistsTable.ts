import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { MediaKind, MediaRecord } from './AbstractMediaTable';
import { ManyToManyPolyRelation } from '../Relations/ManyToManyPolyRelation';
import { DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { Converters, FieldConverters } from '../Converters';

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        items: ManyToManyPolyRelation<PlaylistRecord, MediaRecord>;
    }

    fieldConverters: FieldConverters<PlaylistRecord, PlaylistRecordSql> = {
        id: Converters.id(),
        updatedAt: Converters.date(),
        createdAt: Converters.date(),
    };

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            items: new ManyToManyPolyRelation( 'items', map, tables.playlistsMedia, 'playlistId', 'mediaKind', 'mediaId' ).orderBy( 'order' )
        };
    }
}

export interface PlaylistRecord extends BaseRecord, TimestampedRecord {
    device : string;
}

export interface PlaylistRecordSql extends BaseRecordSql, TimestampedRecordSql {
    
}
