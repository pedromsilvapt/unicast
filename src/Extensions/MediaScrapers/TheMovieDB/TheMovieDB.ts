import { IScraper, IScraperQuery } from "../../../MediaScrapers/IScraper";
import { AsyncCache, CacheOptions, CacheStorage } from "../../../MediaScrapers/ScraperCache";
import { MovieMediaRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, ArtRecord, ArtRecordKind, MediaKind, ExternalReferences, AllMediaKinds, RoleRecord } from "../../../MediaRecord";
import { UnicastServer } from "../../../UnicastServer";
import { MediaRecordFactory } from "./MediaRecordFactory";
import { MovieDBEpisodeExternals, MovieDBSeason, MovieDBShow, MovieDBShowExternals, MovieDBShowRatings, MovieDBShowSeason } from "./Responses";
import { Client as MovieDB } from './Client';
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { Logger } from 'clui-logger';
import * as sortBy from 'sort-by';

export class TheMovieDB implements IScraper {
    server : UnicastServer;
    
    name : string = 'moviedb';

    logger : Logger;

    cache : AsyncCache<any> = new AsyncCache();

    factory : MediaRecordFactory;

    protected moviedb : MovieDB;

    constructor ( apiKey : string ) {
        this.moviedb = new MovieDB( {
            loadMethods: true,
            apiKey: apiKey
        } );

        this.factory = new MediaRecordFactory( this );
    }

    onEntityInit () {
        this.logger = this.server.logger.service( `scrapers/${ this.name }` );

        this.cache.storage = new CacheStorage( this.server.storage.getPath( `cache/scrapers/${ this.name }.json` ) );

        this.cache.autoSaveDelay = 500;

        this.cache.cloneOnRetrieval = true;

        this.server.onStart.subscribe( () => this.cache.load() );
    }

    protected getCacheKey ( method : string, id : string ) : string {
        return `${ method }|${ id }`;
    }

    protected runCachedTask<T extends any> ( method : string, id : string, query : IScraperQuery, runner : () => Promise<T>, options : CacheOptions = {} ) {
        const key = this.getCacheKey( method, id );

        const cached = this.cache.get<T>( key, options );

        if ( cached ) {
            return cached;
        }

        var promise = Promise.resolve( runner() ).catch( error => {
            this.logger.error(`(cached:${ key }) ${ error?.message ?? error ?? 'Undefined error' }`);

            throw error;
        } );

        return this.cache.set<T>( key, promise, options );
    }

    protected moviedbRequest<T = any> ( url : string, params: object = {}, options: CacheOptions = {} ) {
        const key = Object.keys( params ).sort().map( key => '' + key + '=' + params[ key ]  ).join( ',' );

        return this.runCachedTask<T>( 'moviedb.request.' + url, key, {}, () => {
            return this.moviedb.request<T>( url, 'GET', params );
        }, options );
    }

    protected moviedbCall<T = any> ( method : string, params: object = {}, options: CacheOptions = {} ) {
        const key = Object.keys( params ).sort().map( key => '' + key + '=' + params[ key ]  ).join( ',' );

        return this.runCachedTask<T>( 'moviedb.' + method, key, {}, () => {
            return this.moviedb.call<T>( method, params );
        }, options );
    }

    protected async getConfiguration ( cache : CacheOptions = {} ) : Promise<any> {
        return this.moviedbCall( 'configuration', {}, cache );
    }

    protected async getArtPath ( filePath : string, width : number | string = 'original' ) : Promise<string> {
        const configuration = await this.getConfiguration();

        return configuration.images.base_url + ( typeof width === 'number' ? `w${ width }` : width ) + filePath;
    }

    protected getExternalCacheKey ( external : ExternalReferences ) : string {
        return Object.keys( external ).sort().map( key => '' + key + '=' + external[ key ]  ).join( ',' );
    }

    protected async getExternal ( external : ExternalReferences, kinds : MediaKind[] = null, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const externalString = this.getExternalCacheKey( external );

        const keysMapper = {
            'imdb': 'imdb_id',
            'tvdb': 'tvdb_id'
        };

        const kindsMapper = {
            [ MediaKind.Movie ]: 'movie_results',
            [ MediaKind.TvShow ]: 'tv_results',
            [ MediaKind.TvSeason ]: 'tv_season_results',
            [ MediaKind.TvEpisode ]: 'tv_episode_results'
        };

        const recordsMapper = {
            [ MediaKind.Movie ]: this.getMovie.bind( this ),
            [ MediaKind.TvShow ]: this.getTvShow.bind( this ),
            [ MediaKind.TvSeason ]: this.getTvSeason.bind( this ),
            [ MediaKind.TvEpisode ]: this.getTvEpisode.bind( this )
        };

        if ( !kinds ) kinds = AllMediaKinds;

        let aggregateErrors: any[] | null = null;

        return this.runCachedTask<MovieMediaRecord>( 'getExternal', externalString, query, async () => {
            for ( let source of Object.keys( external ) ) {
                try {
                    if ( source === 'moviedb' && kinds.length > 0 ) {
                        return recordsMapper[ kinds[ 0 ] ]( external[ source ] );
                    } else if ( source in keysMapper ) {
                        // The method `find` returns an object of arrays: each key of the object is a kind (movie, show, etc...) and its 
                        // value is the list of media of that kind that matched the query
                        const results = await this.moviedbCall( 'find', { id: external[ source ], external_source: keysMapper[ source ] }, cache );
            
                        for ( let kind of kinds ) {
                            const kindResult = results?.[ kindsMapper[ kind ] ];
    
                            if ( kindResult && kindResult.length > 0 ) {
                                let id = kindResult[ 0 ].id.toString();
    
                                if ( kind === MediaKind.TvSeason ) {
                                    id = MediaRecordFactory.toTvSeasonId( kindResult[ 0 ].show_id, kindResult[ 0 ].season_number );
                                } else if ( kind === MediaKind.TvEpisode ) {
                                    id = MediaRecordFactory.toTvEpsiodeId( kindResult[ 0 ].show_id, kindResult[ 0 ].season_number, kindResult[ 0 ].episode_number );
                                }
    
                                return await recordsMapper[ kind ]( id, cache );
                            }
                        }
                    }
                } catch (error) {
                    if ( aggregateErrors == null ) {
                        aggregateErrors = [ error ];
                    } else {
                        aggregateErrors.push( error );
                    }
                }
            }

            if ( aggregateErrors != null && aggregateErrors.length > 0 ) {
                throw aggregateErrors[ 0 ];
            }
        }, cache );
    }

    protected async transformArtResponse ( keys: Record<string, ArtRecordKind>, rawArtwork: Record<string, any[]>, kind ?: ArtRecordKind, ) : Promise<ArtRecord[]> {
        const artwork: ArtRecord[] = [];
        
        for ( let key of Object.keys( keys ) ) {
            const kind : ArtRecordKind = keys[ key ];

            for ( let art of rawArtwork[ key ] ) {
                const url = await this.getArtPath( art.file_path, 'original' );
                
                artwork.push( {
                    id: url,
                    url: url,
                    height: art.height,
                    width: art.width,
                    score: art.vote_average,
                    kind: kind
                } );
            }
        }

        if ( kind ) {
            return artwork.filter( art => art.kind == kind );
        }

        return artwork;
    }

    getMovieArt ( id : string, kind ?: ArtRecordKind, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<ArtRecord[]>( 'getMovieArt', id + kind, query, async () => {
            const rawMovie = await this.moviedbCall( 'movieImages', { id: id }, cache );
    
            const keys = { 'backdrops': ArtRecordKind.Background, 'posters': ArtRecordKind.Poster };

            return this.transformArtResponse( keys, rawMovie, kind );
        }, cache );
    }

    getMovieExternal ( external : ExternalReferences, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return this.getExternal( external, [ MediaKind.Movie ], query, cache ) as Promise<MovieMediaRecord>;
    }

    getMovie ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return this.runCachedTask<MovieMediaRecord>( 'getMovie', id, query, async () => {
            const rawMovie = await this.moviedbCall( 'movie', { id: id }, cache );

            const releaseDates = await this.moviedbCall( 'movieRelease_dates', { id: id }, cache );

            return this.factory.createMovieMediaRecord( rawMovie, releaseDates.results );
        }, cache );
    }

    getTvShowArt ( id : string, kind ?: ArtRecordKind, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<ArtRecord[]>( 'getTvShowArt', id + kind, query, async () => {
            const rawArtwork = await this.moviedbCall( 'tvImages', { id: id }, cache );

            const keys = { 'backdrops': ArtRecordKind.Background, 'posters': ArtRecordKind.Poster };
    
            return this.transformArtResponse( keys, rawArtwork, kind );
        }, cache );
    }

    protected getTvShowAndSeasons ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<[TvShowMediaRecord, MovieDBShowSeason[]]> {
        return this.runCachedTask<[TvShowMediaRecord, MovieDBShowSeason[]]>( 'getTvShowAndSeasons', id, query, async () => {
            const [ rawShow, externals, ratings ] = await Promise.all( [
                this.moviedbCall( 'tv', { id: id }, cache ),
                this.moviedbCall( 'tvExternal_ids', { id: id }, cache ),
                this.moviedbCall( 'tvContent_ratings', { id: id }, cache ),
            ] ) as [MovieDBShow, MovieDBShowExternals, MovieDBShowRatings];

            if ( !rawShow ) {
                return [ null, null ];
            }

            const show = this.factory.createTvShowMediaRecord( rawShow, externals, ratings );

            return [ show, rawShow.seasons ];
        }, cache );
    }

    async getTvShow ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        const [ show, _ ] = await this.getTvShowAndSeasons( id, query, cache );

        return show;
    }

    getTvShowExternal ( external : ExternalReferences, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvShow ], query, cache ) as Promise<TvShowMediaRecord>;
    }

    getTvShowSeasons ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord[]> {
        return this.runCachedTask<TvSeasonMediaRecord[]>( 'getTvShowSeasons', id, query, async () => {
            const [ tvShow, rawSeasons ] = await this.getTvShowAndSeasons( id, query, cache );

            if ( !rawSeasons ) {
                return [];
            }

            return rawSeasons.map( season => this.factory.createTvSeasonMediaRecord( season, tvShow ) );
        }, cache );
    }

    async getTvShowSeason ( id : string, season : number, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        const seasons = await this.getTvShowSeasons( id, query, cache );

        return seasons.find( seasonObj => seasonObj.number == season );
    }

    getTvShowEpisodes ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        return this.runCachedTask<TvEpisodeMediaRecord[]>( 'getTvShowEpisodes', id, query, async () => {
            const [ tvShow, rawSeasons ] = await this.getTvShowAndSeasons( id, query, cache );

            if ( !rawSeasons ) {
                return [];
            }

            const seasons: MovieDBSeason[] = await Promise.all( rawSeasons.map( async season => {
                return await this.moviedbCall( 'tvSeason', { id: id, season_number: season.season_number }, cache );
            } ) );

            return await Promise.all( seasons.flatMap( season => {
                return season.episodes.map( async episode => {
                    const externals: MovieDBEpisodeExternals = await this.moviedbCall( 'tvSeasonEpisodeExternal_ids', {
                        id: tvShow.id,
                        season_number: season.season_number,
                        episode_number: episode.episode_number,
                    }, cache );

                    return this.factory.createTvEpisodeMediaRecord( episode, season, tvShow, externals );
                } );
            } ) );
        }, cache );
    }

    getTvShowEpisode ( id : string, season : number, episode : number, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        season = +season;
        episode = +episode;

        const key = `${id}S${season}E${episode}`;

        return this.runCachedTask<TvEpisodeMediaRecord>( 'getTvShowEpisode', key, query, async () => {
            const [ tvShow, _ ] = await this.getTvShowAndSeasons( id, query, cache );

            if ( !tvShow ) {
                return null;
            }

            const rawSeason: MovieDBSeason = await this.moviedbCall( 'tvSeason', { id: id, season_number: season }, cache );

            const rawEpisode = rawSeason.episodes.find( rawEpisode => rawEpisode.episode_number == episode );

            const externals: MovieDBEpisodeExternals = await this.moviedbCall( 'tvSeasonEpisodeExternal_ids', {
                id: tvShow.id,
                season_number: season,
                episode_number: episode,
            }, cache );

            return this.factory.createTvEpisodeMediaRecord( rawEpisode, rawSeason, tvShow, externals );
        }, cache );
    }

    getTvSeason ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        const [ tvShowId, seasonNumber ] = MediaRecordFactory.fromTvSeasonId( id );

        return this.getTvShowSeason( tvShowId, seasonNumber, query, cache );
    }

    getTvSeasonExternal ( external : ExternalReferences, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvSeason ], query, cache ) as Promise<TvSeasonMediaRecord>;
    }

    getTvSeasonEpisodes ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        return this.runCachedTask<TvEpisodeMediaRecord[]>( 'getTvSeasonEpisodes', id, query, async () => {
            const [ tvShowId, seasonNumber ] = MediaRecordFactory.fromTvSeasonId( id );

            const [ tvShow, _ ] = await this.getTvShowAndSeasons( tvShowId, query, cache );

            if ( !tvShow ) {
                return null;
            }

            const rawSeason = await this.moviedbCall( 'tvSeason', { id: tvShowId, season_number: seasonNumber }, cache );

            return await Promise.all( rawSeason.episodes.map( async episode => {
                const externals: MovieDBEpisodeExternals = await this.moviedbCall( 'tvSeasonEpisodeExternal_ids', {
                    id: tvShow.id,
                    season_number: rawSeason.season_number,
                    episode_number: episode.episode_number,
                }, cache );

                return this.factory.createTvEpisodeMediaRecord( episode, rawSeason, tvShow, externals );
            } ) );
        }, cache );
    }

    getTvEpisode ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        const [ tvShowId, seasonNumber, episodeNumber ] = MediaRecordFactory.fromTvEpisodeId( id );

        return this.getTvShowEpisode( tvShowId, seasonNumber, episodeNumber, query, cache );
    }

    getTvEpisodeExternal ( external : ExternalReferences, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvEpisode ], query, cache ) as Promise<TvEpisodeMediaRecord>;
    }

    async getTvSeasonArt ( id : string, kind ?: ArtRecordKind, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<ArtRecord[]>( 'getTvSeasonArt', id + kind, query, async () => {
            const [ tvShowId, seasonNumber ] = MediaRecordFactory.fromTvSeasonId( id );

            const rawArtwork = await this.moviedbCall( 'tvSeasonImages', { id: tvShowId, season_number: seasonNumber }, cache );
            
            const keys = { 'posters': ArtRecordKind.Poster };

            return this.transformArtResponse( keys, rawArtwork, kind );
        }, cache );
    }
    
    async getTvEpisodeArt ( id : string, kind ?: ArtRecordKind, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<ArtRecord[]>( 'getTvEpisodeArt', id + kind, query, async () => {
            const [ tvShowId, seasonNumber, episodeNumber ] = MediaRecordFactory.fromTvEpisodeId( id );

            const rawArtwork = await this.moviedbCall( 'tvSeasonEpisodeImages', { 
                id: tvShowId, 
                season_number: seasonNumber, 
                episode_number: episodeNumber 
            }, cache );
            
            const keys = { 'stills': ArtRecordKind.Thumbnail };

            return this.transformArtResponse( keys, rawArtwork, kind );
        }, cache );
    }

    getMediaArt ( record : MediaRecord, kind ?: ArtRecordKind, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const id = record.external.moviedb;

        if ( !id ) {
            return Promise.resolve( [] );
        }

        if ( record.kind === MediaKind.Movie ) {
            return this.getMovieArt( id, kind, query, cache );
        } else if ( record.kind === MediaKind.TvShow ) {
            return this.getTvShowArt( id, kind, query, cache );
        } else if ( record.kind === MediaKind.TvSeason ) {
            return this.getTvSeasonArt( id, kind, query, cache );
        } else if ( record.kind === MediaKind.TvEpisode ) {
            return this.getTvEpisodeArt( id, kind, query, cache );
        }
    }

    
    /* Get Media Cast */
    getMovieCast ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return this.runCachedTask<RoleRecord[]>( 'getMovieCast', id, query, async () => {
            const actors : any = await this.moviedbCall( 'movieCredits', { id }, cache );

            return actors.cast.map( actor => this.factory.createActorRoleRecord( actor ) );
        }, cache );
    }

    getTvShowCast ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return this.runCachedTask<RoleRecord[]>( 'getTvShowCast', id, query, async () => {
            const actors : any = await this.moviedbRequest( '/tv/{id}/aggregate_credits', { id }, cache );

            actors.cast.sort( sortBy( '-total_episode_count', '-popularity', 'order' ) );

            return actors.cast.map( ( actor, order ) => this.factory.createActorRoleRecord( actor, order ) );
        }, cache );
    }

    getTvSeasonCast ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return Promise.resolve( [] );
    }

    getTvEpisodeCast ( id : string, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return Promise.resolve( [] );
    }

    getMediaCast ( record : MediaRecord, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        const id = record.external.tvdb;

        if ( !id ) {
            return Promise.resolve( [] );
        }

        if ( record.kind === MediaKind.Movie ) {
            return this.getMovieCast( id, query, cache );
        } else if ( record.kind === MediaKind.TvShow ) {
            return this.getTvShowCast( id, query, cache );
        } else if ( record.kind === MediaKind.TvSeason ) {
            return this.getTvSeasonCast( id, query, cache );
        } else if ( record.kind === MediaKind.TvEpisode ) {
            return this.getTvEpisodeCast( id, query, cache );
        }
    }

    /* Searching Media */
    searchMovie ( name : string, limit : number = 5, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord[]> {
        return this.runCachedTask<MovieMediaRecord[]>( 'searchMovie', '' + limit + '|' + name, query, async () => {
            const yearMatch = name.match( /(\(?((?:19[0-9]|20[0-2])[0-9])\)?)$/i );

            const year = yearMatch ? +yearMatch[ 2 ] : void 0;

            const title = yearMatch ? name.substring( 0, yearMatch.index - 1 ) : name;

            const rawMovie = await this.moviedbCall( 'searchMovie', { query: title, year: year }, cache );

            // If searching for the movie with the year parameter returns no results, try searching only with the title
            if ( rawMovie.results.length == 0 && typeof year === 'number' ) {
                return this.searchMovie( title, limit, query, cache );
            }

            return Promise.all( rawMovie.results.slice( 0, limit ).map( movie => this.getMovie( movie.id, query, cache ) ) as any[] );
        }, cache );
    }

    searchTvShow ( name : string, limit ?: number, query: IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord[]> {
        return this.runCachedTask<TvShowMediaRecord[]>( 'searchTvShow', '' + limit + '|' + name, query, async () => {
            const apiQuery: any = { query: name };

            if ( query.year != null ) {
                apiQuery.first_air_date_year = query.year;
            }

            const rawShows = await this.moviedbCall( 'searchTv', apiQuery, cache );

            if ( !rawShows?.results ) {
                return [];
            }

            return Promise.all( rawShows.results.slice( 0, limit ).map( show => this.getTvShow( show.id, query, cache ) ) as any[] );
        }, cache );
    }
}