import { TvEpisodeMediaRecord, TvShowMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, ArtRecord, MediaRecord, ArtRecordKind, ExternalReferences, RoleRecord } from "../MediaRecord";
import { AsyncCache, CacheOptions } from "./ScraperCache";
import { UnicastServer } from "../UnicastServer";

export interface IScraperQuery {
    year ?: number;
    language ?: string;
    boxSet ?: string;
}

export interface IScraper {
    readonly name : string;

    server : UnicastServer;

    cache : AsyncCache<any>;
    
    getMovie ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MovieMediaRecord>;
    
    getMovieExternal ( external : ExternalReferences, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MovieMediaRecord>;

    getTvShow ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvShowMediaRecord>;
    
    getTvShowExternal ( external : ExternalReferences, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvShowMediaRecord>;

    getTvShowSeasons ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord[]>;

    getTvShowSeason ( id : string, season : number, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvShowEpisodes ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]>;

    getTvShowEpisode ( id : string, season : number, episode : number, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;

    getTvSeason ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvSeasonExternal ( external : ExternalReferences, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvSeasonEpisodes ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]>;

    getTvEpisode ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;

    getTvEpisodeExternal ( external : ExternalReferences, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;


    getMovieArt ( id : string, kind ?: ArtRecordKind, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvShowArt ( id : string, kind ?: ArtRecordKind, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvSeasonArt ( id : string, kind ?: ArtRecordKind, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvEpisodeArt ( id : string, kind ?: ArtRecordKind, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getMediaArt ( record : MediaRecord, kind ?: ArtRecordKind, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]>;


    getMovieCast ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvShowCast ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvSeasonCast ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvEpisodeCast ( id : string, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getMediaCast ( record : MediaRecord, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]>;


    searchMovie ( name : string, limit ?: number, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MovieMediaRecord[]>;

    searchTvShow ( name : string, limit ?: number, options ?: IScraperQuery, cache ?: CacheOptions ) : Promise<TvShowMediaRecord[]>;   

    // searchPerson ( name : string, limit ?: number, cache ?: CacheOptions ) : Promise<PersonRecord[]>;
}