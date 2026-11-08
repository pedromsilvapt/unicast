import { collect, first, groupingBy } from 'data-collectors';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { BaseTable, chunk, DeleteKeysQueryOptions, EntityRecord, EntityRecordSql, QueryOptions } from './BaseTable';
import type { Knex } from 'knex';
import type { DatabaseTables } from '../Database';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import type { MediaSourceDetails } from '../../MediaProviders/MediaSource';
import { pp } from 'clui-logger';
import { HasOneRelation } from '../Relations/OneToOneRelation';
import { MediaProbeRecord } from './MediaProbesTable';

export abstract class AbstractMediaTable<R extends MediaRecord> extends BaseTable<R> {
    protected readonly abstract kind : MediaKind;

    baseline : Partial<R> = {};

    foreignMediaKeys : MediaTableForeignKeys = {};

    declare relations : {
        collections: ManyToManyRelation<R, CollectionRecord>,
        cast: ManyToManyRelation<R, PersonRecord>
        probe: HasOneRelation<R, MediaProbeRecord, { probe: MediaProbeRecord | null }>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            collections: new ManyToManyRelation( 'collections', tables.collectionsMedia, tables.collections, 'mediaId', 'collectionId' ).poly( 'mediaKind', this.kind ),
            cast: new ManyToManyRelation( 'cast', tables.mediaCast, tables.people, 'mediaId', 'personId' ).savePivot( 'cast' ).poly( 'mediaKind', this.kind ),
            probe: new HasOneRelation( 'probe', tables.probes, 'mediaId' ),
        };
    }

    protected async createUniqueMediaIds ( kinds : MediaKind[], options : QueryOptions = {} ) : Promise<number[]> {
        const ids = await this.queryTable( 'media', options ).insert( kinds.map( kind => ( { kind } ) ), [ 'id' ] );

        return ids.map( s => s.id );
    }

    async create ( record : R, options : QueryOptions = {} ) : Promise<R> {
        // Creating the `media` row and the per-kind row must be atomic, otherwise a failure on the second insert
        // leaves behind a phantom row in `media`
        return await this.withTransaction( options, async options => {
            if ( record.id == null ) {
                const id = ( await this.createUniqueMediaIds( [ this.kind ], options ) )[ 0 ];

                record.id = '' + id;
            }

            return await super.create( record, options );
        } );
    }

    async createMany ( recordsIter : Iterable<R>, options : QueryOptions = {} ) : Promise<R[]> {
        const records = Array.from( recordsIter );

        return await this.withTransaction( options, async options => {
            const recordsWithNoId = records.filter( rec => rec.id == null );

            if ( recordsWithNoId.length > 0 ) {
                const ids = await this.createUniqueMediaIds( recordsWithNoId.map( _ => this.kind ), options );

                recordsWithNoId.forEach( ( record, index ) => record.id = '' + ids[ index ] );
            }

            return await super.createMany( records, options );
        } );
    }

    /**
     * Runs the callback inside the transaction given in the options, or inside a new one when none is given.
     */
    protected async withTransaction<T> ( options : QueryOptions | null, callback : ( options : QueryOptions ) => Promise<T> ) : Promise<T> {
        if ( options?.transaction != null ) {
            return await callback( options );
        }

        return await this.connection.transaction( trx => callback( { ...( options ?? {} ), transaction: trx } ) );
    }

    /**
     * Deletes the rows from the parent `media` table. Every table that references media records does so through a
     * foreign key to `media(id, kind)` with `ON DELETE CASCADE`, so this is what removes the dependent rows (probes,
     * cast, collections, etc...). Deleting only the row from the per-kind table would leave them behind until a repair.
     */
    protected async deleteMediaRows ( ids : string[], options : QueryOptions | null ) : Promise<void> {
        if ( ids.length === 0 ) {
            return;
        }

        for ( const idsChunk of chunk( ids, 500 ) ) {
            let query = this.connection.table( 'media' )
                .whereIn( 'id', idsChunk.map( id => +id ) )
                .where( 'kind', this.kind );

            if ( options?.transaction != null ) {
                query = query.transacting( options.transaction );
            }

            await query.delete();
        }
    }

    async delete ( id : string, options : QueryOptions = {} ) : Promise<boolean> {
        if ( id == null ) {
            // Let the base implementation throw the appropriate error
            return await super.delete( id, options );
        }

        return await this.withTransaction( options, async options => {
            const deleted = await super.delete( id, options );

            await this.deleteMediaRows( [ id ], options );

            return deleted;
        } );
    }

    async deleteKeys ( keys : any[], options : DeleteKeysQueryOptions = {} ) : Promise<number> {
        if ( keys.length === 0 ) {
            return 0;
        }

        return await this.withTransaction( options, async ( { transaction } ) => {
            const column = options.index || 'id';

            const converter = this.fieldConverters[ column ];

            let query = this.query( { transaction } )
                .select( 'id' )
                .whereIn( column, converter != null ? keys.map( key => converter.serialize( key ) ) : keys );

            if ( options.query ) {
                query = options.query( query );
            }

            const ids = await this.selectIds( query );

            const deletedCount = await super.deleteKeys( ids, { transaction } );

            await this.deleteMediaRows( ids, { transaction } );

            return deletedCount;
        } );
    }

    async deleteMany ( predicate ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, limit : number = Infinity, options : QueryOptions = {} ) : Promise<number> {
        return await this.withTransaction( options, async options => {
            let query = this.query( options ).select( 'id' );

            if ( predicate != null ) {
                query = predicate( query );
            }

            if ( limit && limit < Infinity ) {
                query = query.limit( limit );
            }

            const ids = await this.selectIds( query );

            const deletedCount = await super.deleteKeys( ids, options );

            await this.deleteMediaRows( ids, options );

            return deletedCount;
        } );
    }

    protected async selectIds ( query : Knex.QueryBuilder ) : Promise<string[]> {
        const rows : { id : number }[] = await query;

        return rows.map( row => '' + row.id );
    }

    async repair ( records : string[] = null ) {
        const phantomIds = await this.connection.table( 'media' )
            .select('media.id')
            .leftJoin(this.tableName,
                join => join.on('media.id', '=', this.tableName + '.id'))
            .whereNull(this.tableName + '.id')
            .andWhere('media.kind', '=', this.kind);

        if ( phantomIds.length > 0 ) {
            this.database.logger.warn(pp`Found ${phantomIds.length} phantom records on media table for kind ${this.kind}. Deleting them.`);

            await this.connection.table( 'media' ).whereIn( 'id', phantomIds.map( r => r.id ) ).delete();
        }

        if ( !records ) {
            records = ( await this.find() ).map( record => record.id );
        }

        await super.repair( records );
    }
}

export interface MediaRecord extends EntityRecord {
    art : MediaRecordArt;
    repository ?: string;
    repositoryPaths ?: string[];
    kind : MediaKind;
    title : string;
    transient ?: boolean;
    playCount : number;
    lastPlayedAt : Date | null;
    lastPlayedAtLegacy ?: Date[] | null;
}

export interface MediaRecordSql extends EntityRecordSql {
    genres: string;
    art: string;
    repositoryPaths: string;
    transient: number;
    lastPlayedAt: number;
    lastPlayedAtLegacy: string;
}

export interface PlayableMediaRecord extends MediaRecord {
    runtime : number;
    sources : MediaSourceDetails[];
    metadata : MediaMetadata | null; // TODO
    watched : boolean;
    addedAt : Date;
}

export interface PlayableMediaRecordSql extends MediaRecordSql {
    sources : string;
    metadata : string;
    watched : number;
    addedAt : number;
}

// This is the object that is stored in the art property of each MediaRecord
export interface MediaRecordArt {
    thumbnail : string;
    poster : string;
    background : string;
    banner : string;
}

export type MediaResolution = '4320p' | '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p' | '240p';
export type MediaBitDepth = '8bit' | '10bit';
export type MediaColorSpace = 'SDR' | 'HDR';
export type MediaSource = 'BluRay' | 'WEB-DL' | 'WEBRIP' | 'WEBCAP' |
                          'HDTV' | 'DVDR' | 'SCR' | 'CAMRip' | 'TS' |
                          'WP' | 'PPV' | 'VODRip' | 'DVDRip' | 'R5'
                          ;

export interface MediaMetadataVideo {
    resolution: MediaResolution | null;
    codec: string;
    framerate: number;
    bitdepth: MediaBitDepth | null;
    colorspace: MediaColorSpace | null;
}

export interface MediaMetadataAudio {
    codec: string;
    bitrate: number;
    /** List of possible values: http://web.archive.org/web/20250105210052/https://github.com/FFmpeg/FFmpeg/blob/539cea31830e71f1ce290c56ff2d639b209c2ac2/libavutil/channel_layout.c#L189C21-L189C41  */
    channels: string;
    channelsLayout?: string;
    language: string;
}

export interface MediaMetadataSubtitles {
    codec: string;
    language: string;
    forced: boolean;
    hearingImpaired: boolean;
}

export interface MediaMetadata {
    video: MediaMetadataVideo;
    additionalVideo: MediaMetadataVideo[];
    audio?: MediaMetadataAudio;
    additionalAudio: MediaMetadataAudio[];
    subtitles?: MediaMetadataSubtitles;
    additionalSubtitles: MediaMetadataSubtitles[];
    source: MediaSource | null;
    bitrate: number | null;
    duration: number;
    size: number;
}

export enum MediaKind {
    Movie = 'movie',
    TvShow = 'show',
    TvSeason = 'season',
    TvEpisode = 'episode',
    Custom = 'custom'
}

export var AllMediaKinds : MediaKind[] = [
    MediaKind.Movie,
    MediaKind.TvShow,
    MediaKind.TvSeason,
    MediaKind.TvEpisode,
    MediaKind.Custom
];

export interface MediaTableForeignKeys {
    [ kind : string ]: MediaKind;
}
