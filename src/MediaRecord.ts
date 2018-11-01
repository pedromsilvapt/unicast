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

export interface MediaRecord {
    id ?: string;
    internalId : string;
    repository ?: string;
    kind : MediaKind;
    title : string;
    art : MediaRecordArt;
    external : ExternalReferences;
    transient ?: boolean;
}

export interface PlayableMediaRecord extends MediaRecord {
    runtime : number;
    sources : MediaSourceDetails[];
    quality : PlayableQualityRecord;
    playCount : number;
    watched : boolean;
    lastPlayed : Date;
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
    subtitle: string;
    plot: string;
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

        console.log( a, na, b, nb );

        if ( na == null || nb == null ) {
            return 0;
        }

        const ia = this.list.findIndex( pool => pool[ 0 ] == na );
        const ib = this.list.findIndex( pool => pool[ 0 ] == nb );

        console.log( a, ia, b, ib );

        return 1 - ( Math.abs( ia - ib ) / this.list.length );
    }

    static normalize ( source : string ) : string {
        if ( !source ) {
            return null;
        }

        source = source.toLowerCase();

        const pool = this.list.find( pool => pool.some( each => each.toLowerCase() == source ) );

        if ( pool ) {
            return pool[ 0 ];
        }

        return null;
    }

    static findAny ( string : string ) : string {
        if ( !string ) {
            return null;
        }

        let source : string = null;

        for ( let pool of MediaSources.list ) {
            source = pool.find( each => string.toLowerCase().includes( each.toLowerCase() ) )

            if ( source ) {
                break;
            }
        }

        return source;
    }
}