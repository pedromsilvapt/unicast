import { TvEpisodeMediaRecord, TvShowMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, ArtRecord, MediaRecord, ArtRecordKind, ExternalReferences, RoleRecord } from "../MediaRecord";
import { AsyncCache, CacheOptions } from "./ScraperCache";
import { UnicastServer } from "../UnicastServer";


export interface IScraper {
    readonly name : string;

    server : UnicastServer;

    cache : AsyncCache<any>;
    
    getMovie ( id : string, cache ?: CacheOptions ) : Promise<MovieMediaRecord>;
    
    getMovieExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<MovieMediaRecord>;

    getTvShow ( id : string, cache ?: CacheOptions ) : Promise<TvShowMediaRecord>;
    
    getTvShowExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvShowMediaRecord>;

    getTvShowSeasons ( id : string, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord[]>;

    getTvShowSeason ( id : string, season : number, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvShowEpisodes ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]>;

    getTvShowEpisode ( id : string, season : number, episode : number, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;

    getTvSeason ( id : string, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvSeasonExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord>;

    getTvSeasonEpisodes ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]>;

    getTvEpisode ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;

    getTvEpisodeExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord>;


    getMovieArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvShowArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvSeasonArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getTvEpisodeArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]>;

    getMediaArt ( record : MediaRecord, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]>;


    getMovieCast ( id : string, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvShowCast ( id : string, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvSeasonCast ( id : string, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getTvEpisodeCast ( id : string, cache ?: CacheOptions ) : Promise<RoleRecord[]>;

    getMediaCast ( record : MediaRecord, cache ?: CacheOptions ) : Promise<RoleRecord[]>;


    searchMovie ( name : string, limit ?: number, cache ?: CacheOptions ) : Promise<MovieMediaRecord[]>;

    searchTvShow ( name : string, limit ?: number, cache ?: CacheOptions ) : Promise<TvShowMediaRecord[]>;   

    // searchPerson ( name : string, limit ?: number, cache ?: CacheOptions ) : Promise<PersonRecord[]>;
}