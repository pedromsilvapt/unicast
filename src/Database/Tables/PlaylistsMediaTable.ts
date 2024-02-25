import { Converters, FieldConverters } from '../Converters';
import { DatabaseTables } from '../Database';
import { BelongsToOneRelation } from '../Relations/OneToOneRelation';
import { MediaKind } from './AbstractMediaTable';
import { BaseRecord, BaseRecordSql, BaseTable, TimestampedRecord, TimestampedRecordSql } from './BaseTable';
import { PlaylistRecord } from './PlaylistsTable';

export class PlaylistsMediaTable extends BaseTable<PlaylistMediaRecord> {
    readonly tableName : string = 'playlistMedia';

    dateFields = [ 'createdAt', 'updatedAt' ];

    declare relations: {
        playlist: BelongsToOneRelation<PlaylistMediaRecord, PlaylistRecord>
    }

    fieldConverters: FieldConverters<PlaylistMediaRecord, PlaylistMediaRecordSql> = {
        id: Converters.id(),
        playlistId: Converters.id(),
        mediaId: Converters.id(),
        updatedAt: Converters.date(),
        createdAt: Converters.date(),
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            playlist: new BelongsToOneRelation( 'playlist', tables.playlists, 'playlistId' )
        };
    }
}

export interface PlaylistMediaRecord extends BaseRecord, TimestampedRecord {
    playlistId: string;
    mediaId: string;
    mediaKind: MediaKind;
    order: number;
}

export interface PlaylistMediaRecordSql extends BaseRecordSql, TimestampedRecordSql {
    playlistId: number;
    mediaId: number;
}
