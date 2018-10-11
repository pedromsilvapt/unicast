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