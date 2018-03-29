import { MediaRecord, MediaKind, PlayableQualityRecord } from "../../MediaRecord";
import { IMediaRepository, MediaQuery } from "../BaseRepository/IMediaRepository";
import { KodiApi } from "./KodiApi";
import { IMediaProvider } from "../../MediaProviders/BaseMediaProvider/IMediaProvider";
import * as parseQuality from 'parse-torrent-name';
import * as path from 'path';
import { SubtitlesKodiRepository } from "./SubtitlesKodiRepository";

export abstract class BaseKodiRepository<R extends MediaRecord> implements IMediaRepository<R> {
    protected abstract readonly internalKind : string;

    abstract readonly kind : MediaKind;

    readonly provider : IMediaProvider;

    readonly indexable : boolean = true;

    subtitles : SubtitlesKodiRepository;

    get name () : string {
        return this.provider.name;
    }

    kodi: KodiApi;

    transformer ?: RecordTransformer;

    constructor ( provider : IMediaProvider, kodi : KodiApi, subtitles ?: SubtitlesKodiRepository ) {
        this.provider = provider;
        this.kodi = kodi;
        this.subtitles = subtitles;
    }
    
    protected createParams ( query : MediaQuery ) : any {
        const wantsDetails : boolean = 'id' in query;

        const params : any = {};

        if ( query.id ) {
            params[ this.internalKind + 'id' ] = +query.id;
        }

        // Boolean flag that is true when requesting single item by id
        if ( !wantsDetails ) {
            if ( 'take' in query || 'skip' in query ) {
                const skip = query.skip || 0;
                const take = query.take || Infinity;

                params.limits = { start : skip, end: take === Infinity ? -1 : skip + take };
            }

            if ( query.sortBy ) {
                params.sort = { order: query.sortBy.ascending ? 'ascending' : 'descending', method: query.sortBy.field, ignorearticle: false };
            }

            if ( query.search ) {
                params.filter = { field: 'title', operator: 'contains', value: '' + query.search };
            }

            if ( query.source ) {
                params.filter = { field: 'filename', operator: 'is', value: '' + query.source };
            }
        }

        return params;
    }

    async available () : Promise<boolean> {
        return this.kodi.available();
    }

    abstract fetch ( id : string, query ?: MediaQuery ) : Promise<R>;

    abstract fetchMany ( ids : string[], query ?: MediaQuery ) : Promise<R[]>;
    
    abstract find ( query ?: MediaQuery ) : Promise<R[]>;
}

export interface RecordTransformerCallback {
    ( source : any, field : string, kind : MediaKind ) : any;
}

export type RecordTransformSchemaValue = string | RecordTransformerSchema | RecordTransformerCallback;

export interface RecordTransformerSchema {
    [ property : string ] : RecordTransformSchemaValue;
}

export class RecordTransformer {
    
    parent ?: RecordTransformer;

    schema : RecordTransformerSchema;

    constructor ( schema : RecordTransformerSchema, parent ?: RecordTransformer ) {
        this.schema = schema;
        this.parent = parent;
    }

    protected doField ( original : any, kind : MediaKind, field : string, schema : RecordTransformSchemaValue ) {
        if ( typeof schema === 'string' ) {
            return original[ schema ];
        } else if ( typeof schema === 'function' ) {
            return schema( original, field, kind );
        } else {
            return this.doObjectForSchema<any>( original[ field ], kind, schema );
        }
    }

    protected doObjectForSchema<T> ( original : any, kind : MediaKind, schema : RecordTransformerSchema ) : T {
        const mapped : any = {};
        
        for ( let key of Object.keys( schema ) ) {
            mapped[ key ] = this.doField( original, kind, key, schema[ key ] );
        }

        return mapped;
    }

    doObject<T> ( original : any ) : T {
        const kind : MediaKind = original.kind;
        
        return this.doObjectForSchema( original, kind, this.schema );
    }

    doArray<T> ( original : any[] ) : T[] {
        return original.map( object => this.doObject<T>( object ) );
    }
}

export class KodiRecordTransformer extends RecordTransformer {
    constructor ( schema ?: RecordTransformerSchema, parent ?: RecordTransformer ) {
        super( {
            ...schema
        }, parent );
    }
    
    protected decodeTrailerUrl ( trailer : string ) {
        const needle = 'videoid=';

        const index = trailer.indexOf( needle );

        const id = trailer.slice( index + needle.length, trailer.length );

        return 'https://www.youtube.com/watch?v=' + id;
    }

    protected decodeImagePath ( image : string ) {
        if ( typeof image !== 'string' ) {
            return null;
        }

        if ( image.startsWith( 'image://' ) ) {
            image = image.slice( 8, -1 );
        }

        return decodeURIComponent( image );
    }

    parseQuality ( file : string ) : PlayableQualityRecord {
        const quality = parseQuality( path.basename( file, path.extname( file ) ) ) || {};

        return {
            codec: quality.codec || null,
            releaseGroup: quality.group || null,
            resolution: quality.resolution || null,
            source: quality.quality || null
        };
    }
}