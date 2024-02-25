import { collect, first, groupingBy } from 'data-collectors';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { BaseTable, EntityRecord, EntityRecordSql, QueryOptions } from './BaseTable';
import type { DatabaseTables } from '../Database';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import type { MediaSourceDetails } from '../../MediaProviders/MediaSource';

export abstract class AbstractMediaTable<R extends MediaRecord> extends BaseTable<R> {
    protected readonly abstract kind : MediaKind;

    baseline : Partial<R> = {};

    foreignMediaKeys : MediaTableForeignKeys = {};

    declare relations : {
        collections: ManyToManyRelation<R, CollectionRecord>,
        cast: ManyToManyRelation<R, PersonRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            collections: new ManyToManyRelation( 'collections', tables.collectionsMedia, tables.collections, 'mediaId', 'collectionId' ).poly( 'mediaKind', this.kind ),
            cast: new ManyToManyRelation( 'cast', tables.mediaCast, tables.people, 'mediaId', 'personId' ).savePivot( 'cast' ).poly( 'mediaKind', this.kind )
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
    quality : PlayableQualityRecord;
    watched : boolean;
    addedAt : Date;
}

export interface PlayableMediaRecordSql extends MediaRecordSql {
    sources : string;
    quality : string;
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

export interface PlayableQualityRecord {
    source : string;
    resolution : string;
    releaseGroup : string;
    codec : string;
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
