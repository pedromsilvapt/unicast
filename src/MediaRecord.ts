import { MediaSourceDetails } from "./MediaProviders/MediaSource";

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

export type ExternalReferences = { 
    imdb ?: string;
    tvdb ?: string;
    [ key : string ] : string
};

export enum ArtRecordKind {
    Poster = "poster",
    Background = "background",
    Banner = "banner",
    Thumbnail = "thumbnail"
}

// This object represents one single piece of art, that might not even be associated with any MediaRecord
export interface ArtRecord { 
    id : string;
    kind: ArtRecordKind;
    width: number;
    height: number;
    url : string;
    season ?: number;
    score ?: number;
}

// This is the object that is stored in the art property of each MediaRecord
export interface MediaRecordArt {
    thumbnail : string;
    poster : string;
    background : string;
    banner : string;
}

export interface TvSeasonMediaRecordArt extends MediaRecordArt {
    tvshow : MediaRecordArt;
}

export interface PlayableQualityRecord {
    source : string;
    resolution : string;
    releaseGroup : string;
    codec : string;
}

export interface EntityRecord {
    id ?: string;
    internalId : string;
    scraper : string;
    external : ExternalReferences;
    createdAt : Date;
    updatedAt : Date;
}

export interface PersonRecord {
    id ?: string;
    name : string;
    art : MediaRecordArt;
    biography ?: null;
    birthday ?: Date;
    deathday ?: Date;
    naturalFrom ?: string;

    // Foreign Relation
    cast ?: MediaCastRecord;
}

export interface RoleRecord extends PersonRecord {
    role : string;
    order : number;
    appearances ?: number;
    internalId : string;
}

export interface MediaCastRecord extends EntityRecord {
    mediaKind : MediaKind;
    mediaId : string;
    personId : string;
    role : string;
    order : number;
    appearences ?: number;
    createdAt : Date;
    updatedAt : Date;

    person ?: PersonRecord;
    record ?: MediaRecord;
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
}

export interface PlayableMediaRecord extends MediaRecord {
    runtime : number;
    sources : MediaSourceDetails[];
    quality : PlayableQualityRecord;
    watched : boolean;
    addedAt : Date;
}

export interface MovieMediaRecord extends PlayableMediaRecord {
    kind : MediaKind.Movie;
    rating : number;
    genres : string[];
    trailer : string;
    parentalRating : string;
    plot : string;
    year : number;
    tagline : string;
}

export interface TvShowMediaRecord extends MediaRecord {
    kind : MediaKind.TvShow;
    episodesCount : number;
    genres : string[];
    plot : string;
    parentalRating : string;
    rating : number;
    seasonsCount : number;
    year : number;
    watchedEpisodesCount : number;
    watched : boolean;
    addedAt : Date;
}

export interface TvSeasonMediaRecord extends MediaRecord {
    kind : MediaKind.TvSeason;
    art : TvSeasonMediaRecordArt;
    number : number;
    tvShowId : string;
    episodesCount : number;
    watchedEpisodesCount : number;
}

export interface TvEpisodeMediaRecord extends PlayableMediaRecord {
    art: TvSeasonMediaRecordArt,
    kind : MediaKind.TvEpisode;
    number : number;
    seasonNumber : number;   
    tvSeasonId : string;
    rating : number;
    plot : string;
    airedAt : Date;
}

export interface CustomMediaRecord extends PlayableMediaRecord {
    kind: MediaKind.Custom;
    subtitle ?: string;
    plot ?: string;
}



// Utility types and functions
export type RecordsMap<T> = Map<MediaKind, Map<string, T>>;

export function createRecordsMap <T> () : RecordsMap<T> {
    const map : Map<MediaKind, Map<string, T>> = new Map();

    for ( let kind of AllMediaKinds ) map.set( kind, new Map() );

    return map;
}

export type RecordsSet = Map<MediaKind, Set<string>>;

export function createRecordsSet () : RecordsSet {
    const set : Map<MediaKind, Set<string>> = new Map();

    for ( let kind of AllMediaKinds ) set.set( kind, new Set() );

    return set;
}

export function isMovieRecord ( media : MediaRecord ) : media is MovieMediaRecord {
    return media.kind === MediaKind.Movie;
}

export function isTvShowRecord ( media : MediaRecord ) : media is TvShowMediaRecord {
    return media.kind === MediaKind.TvShow;
}

export function isTvSeasonRecord ( media : MediaRecord ) : media is TvSeasonMediaRecord {
    return media.kind === MediaKind.TvSeason;
}

export function isTvEpisodeRecord ( media : MediaRecord ) : media is TvEpisodeMediaRecord {
    return media.kind === MediaKind.TvEpisode;
}

export function isCustomRecord ( media : MediaRecord ) : media is CustomMediaRecord {
    return media.kind === MediaKind.Custom;
}

export function isPlayableRecord ( media : MediaRecord ) : media is PlayableMediaRecord {
    return isMovieRecord( media ) || isTvEpisodeRecord( media ) || isCustomRecord( media );
}

export class MediaSources {
    static list : string[][] = [
        [ 'BluRay', 'Blu-Ray', 'Blu Ray', 'BDR', 'BD5', 'BD9', 'BD25', 'BD50', 'BDRip', 'BRRip' ],
        [ 'WEB-DL', 'WEB.DL', 'WEBDL', 'WEB DL', 'WEB' ],
        [ 'WEBRIP', 'WEB-Rip', 'WEB Rip' ],
        [ 'WEBCAP', 'WEBCAP', 'WEB Cap' ],
        [ 'HDTV', 'PDTV', 'HDTVRip', 'TVRip', 'HDRip', 'DSR', 'DSRip', 'DTHRip', 'DVBRip' ],
        [ 'DVDR', 'DVD-Full', 'Full-Rip', 'ISO Rip', 'DVD-5', 'DVD-9' ],
        [ 'SCR', 'SCREENER', 'DVDSCR', 'DVDSCREENER', 'BDSCR' ],
        [ 'CAMRip', 'CAM' ],
        [ 'TS', 'TELESYNC', 'PDVD' ],
        [ 'WP', 'WORKPRINT' ],
        [ 'PPV', 'PPVRip' ],
        [ 'VODRip', 'VODR' ],
        [ 'DVDRip' ],
        [ 'R5' ]
    ];

    static similarity ( a : string, b : string ) : number {
        const [ na, nb ] = [ this.normalize( a ), this.normalize( b ) ];

        if ( na == null || nb == null ) {
            return 0;
        }

        const ia = this.list.findIndex( pool => pool[ 0 ] == na );
        const ib = this.list.findIndex( pool => pool[ 0 ] == nb );

        return 1 - ( Math.abs( ia - ib ) / this.list.length );
    }

    static normalize ( source : string ) : string {
        if ( !source ) {
            return null;
        }

        const pool = MediaSources.list.find( pool => pool.some( each => each.localeCompare( source, undefined, { sensitivity: 'base' } ) == 0 ) );

        if ( pool ) {
            return pool[ 0 ];
        }

        return null;
    }

    static findAny ( string : string, normalized: boolean = false ) : string {
        if ( !string ) {
            return null;
        }

        let source : string = null;

        const strLower = string.toLowerCase();

        for ( let pool of MediaSources.list ) {
            source = pool.find( each => strLower.includes( each.toLowerCase() ) )

            if ( source ) {
                if ( normalized ) {
                    source = pool[ 0 ];
                }

                break;
            }
        }

        return source;
    }
}

export class MediaExternalMap<T extends MediaRecord = MediaRecord> {    
    /**
     * This variable will hold all media records stored in the database, indexed by their external keys.
     */
    public externals : Map<string, Map<string, T[]>> = new Map();

    public add ( type : string, id : string, media : T ) {
        let dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            dictionary = new Map();
            
            this.externals.set( type, dictionary );
        }

        const array = dictionary.get( id );

        if ( array == null ) {
            dictionary.set( id, [ media ] );
        } else {
            array.push( media );
        }
    }

    public has ( type : string, id : string ) : boolean {
        const dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            return false;
        }

        const array = dictionary.get( id );

        return array != null && array.length > 0;
    }

    public get ( type : string, id : string ) : T[] {
        const dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            return null;
        }

        return dictionary.get( id );
    }

    public addAll ( external : any, record : T ) {
        for ( let key of Object.keys( external || {} ) ) {
            if ( external[ key ] ) {
                this.add( key, external[ key ], record );
            }
        }
    }

    public getAny ( external : any ) : T {
        for ( let key of Object.keys( external || {} ) ) {
            const records = this.get( key, external[ key ] );

            if ( records && records.length > 0 ) {
                return records[ 0 ];
            }
        }
    }

    public deleteRecord ( record : T ) {
        for ( let key of Object.keys( record.external || {} ) ) {
            if ( record[ key ] != null ) {
                const dictionary = this.externals.get( key );

                if ( dictionary != null ) {
                    let matched = dictionary.get( record.external[ key ] );

                    if ( matched != null ) {
                        if ( matched.length == 1 && matched[ 0 ].id == record.id ) {
                            dictionary.delete( record.external[ key ] );
                        } else if ( matched.length > 1 ) {
                            matched = matched.filter( r => r.id != record.id );

                            if ( matched.length == 0 ) {
                                dictionary.delete( record.external[ key ] );
                            } else {
                                dictionary.set( record.external[ key ], matched );
                            }
                        }
                    }
                }
            }
        }
    }

    public * values () : IterableIterator<T[]> {
        for ( const map of this.externals.values() ) {
            yield * map.values();
        }
    }
}
