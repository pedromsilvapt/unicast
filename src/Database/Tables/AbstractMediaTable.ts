import { collect, first, groupingBy } from 'data-collectors';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { BaseTable, EntityRecord, EntityRecordSql, QueryOptions } from './BaseTable';
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
        const rows = kinds.map( kind => ( { kind } ) );

        let query = this.connection.table( 'media' );

        if ( options.transaction != null ) {
            query = query.transacting( options.transaction );
        }

        const ids = await query.insert( rows, [ 'id' ] );

        return ids.map( s => s.id );
    }

    async create ( record : R, options : QueryOptions = {} ) : Promise<R> {
        // TODO Transaction
        if ( record.id == null ) {
            const id = ( await this.createUniqueMediaIds( [ this.kind ], options ) )[ 0 ];

            record.id = '' + id;
        }

        return super.create( record, options );
    }

    async createMany ( recordsIter : Iterable<R>, options : QueryOptions = {} ) : Promise<R[]> {
        const recordsWithNoId = Array.from( recordsIter ).filter( rec => rec.id == null );

        if ( recordsWithNoId.length > 0 ) {
            // TODO Transaction
            const ids = await this.createUniqueMediaIds( recordsWithNoId.map( _ => this.kind ), options );

            let index = 0;

            for ( const record of recordsWithNoId ) {
                record.id = '' + ids[ index++ ];
            }
        }

        return super.createMany( recordsIter, options );
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
