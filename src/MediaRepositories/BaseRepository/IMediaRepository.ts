import { MediaRecord, MovieMediaRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, MediaKind } from "../../MediaRecord";
import { IMediaProvider } from "../../MediaProviders/BaseMediaProvider/IMediaProvider";

export interface MediaQuery {
    id ?: string;
    sortBy ?: { ascending : boolean; field : string; };
    search ?: string;
    source ?: string;
    skip ?: number;
    take ?: number;
}

export interface TvSeasonMediaQuery extends MediaQuery {
    show ?: string;
}

export interface TvEpisodeMediaQuery extends MediaQuery {
    show ?: string;
    season ?: number;
}

export interface IMediaRepository<R extends MediaRecord = MediaRecord, Q extends MediaQuery = MediaQuery> {
    readonly kind : MediaKind;

    readonly name : string;

    readonly provider : IMediaProvider;

    readonly indexable : boolean;

    fetch ( id : string, query ?: Q ) : Promise<R>;

    fetchMany ( ids : string[], query ?: Q ) : Promise<R[]>;

    find ( query ?: Q ) : Promise<R[]>;
}

export interface IMovieMediaRepository extends IMediaRepository<MovieMediaRecord> {
    
}

export interface ITvShowMediaRepository extends IMediaRepository<TvShowMediaRecord> {
    
}

export interface ITvSeasonMediaRepository extends IMediaRepository<TvSeasonMediaRecord, TvSeasonMediaQuery> {
    
}

export interface ITvEpisodeMediaRepository extends IMediaRepository<TvEpisodeMediaRecord, TvEpisodeMediaQuery> {
    
}