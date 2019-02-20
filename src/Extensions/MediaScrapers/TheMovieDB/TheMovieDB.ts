import { IScraper } from "../../../MediaScrapers/IScraper";
import { AsyncCache, CacheOptions, CacheStorage } from "../../../MediaScrapers/ScraperCache";
import { MovieMediaRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, ArtRecord, ArtRecordKind, MediaKind, ExternalReferences, AllMediaKinds } from "../../../MediaRecord";
import { UnicastServer } from "../../../UnicastServer";
import { MediaRecordFactory } from "./MediaRecordFactory";
import { DiagnosticsService } from "../../../Diagnostics";
import * as MovieDB from 'moviedb-api';
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";

export class TheMovieDB implements IScraper {
    server : UnicastServer;
    
    name : string = 'moviedb';

    diagnostics : DiagnosticsService;

    cache : AsyncCache<any> = new AsyncCache();

    protected factory : MediaRecordFactory = new MediaRecordFactory();

    protected moviedb : MovieDB;

    constructor ( apiKey : string ) {
        this.moviedb = new MovieDB( {
            consume: true,
            apiKey: apiKey
        } );
    }

    onEntityInit () {
        this.diagnostics = this.server.diagnostics.service( `scrapers/${ this.name }` );

        this.cache.storage = new CacheStorage( this.server.storage.getPath( `cache/scrapers/${ this.name }.json` ) );

        this.cache.autoSaveDelay = 500;

        this.cache.cloneOnRetrieval = true;

        this.server.onStart.subscribe( () => this.cache.load() );
    }

    protected getCacheKey ( method : string, id : string ) : string {
        return `${ method }|${ id }`;
    }

    protected runCachedTask<T extends any> ( method : string, id : string, runner : () => Promise<T>, options : CacheOptions = {} ) {
        const key = this.getCacheKey( method, id );

        const cached = this.cache.get<T>( key, options );

        if ( cached ) {
            return cached;
        }

        return this.cache.set<T>( key, runner(), options );
    }

    protected async getConfiguration ( cache : CacheOptions = {} ) : Promise<any> {
        return this.runCachedTask<any>( 'getConfiguration', '', () => this.moviedb.configuration(), cache );
    }

    protected async getArtPath ( filePath : string, width : number | string = 'original', cache : CacheOptions = {} ) : Promise<string> {
        const configuration = await this.getConfiguration();

        return configuration.images.base_url + ( typeof width === 'number' ? `w${ width }` : width ) + filePath;
    }


    protected getExternalCacheKey ( external : ExternalReferences ) : string {
        return Object.keys( external ).sort().map( key => '' + key + '=' + external[ key ]  ).join( ',' );
    }

    protected async getExternal ( external : ExternalReferences, kinds : MediaKind[] = null, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const externalString = this.getExternalCacheKey( external );

        const keysMapper = { 'imdb': 'imdb_id' };

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

        return this.runCachedTask<MovieMediaRecord>( 'getMovieExternal', externalString, async () => {
            for ( let source of Object.keys( external ) ) {
                if ( source in keysMapper ) {
                    const results = await this.moviedb.find( { id: external[ source ], external_source: keysMapper[ source ] } );
        
                    for ( let kind of kinds ) {
                        const kindResult = results[ kindsMapper[ kind ] ];

                        if ( kindResult && kindResult.length > 0 ) {
                            return recordsMapper[ kind ]( kindResult[ 0 ].id, cache );
                        }
                    }
                }
            }
        }, cache );
    }

    getMovieArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<ArtRecord[]>( 'getMovieArt', id + kind, async () => {
            const rawMovie = await this.moviedb.movieImages( { id: id } );

            const artwork : ArtRecord[] = [];
    
            const keys = { 'backdrops': ArtRecordKind.Background, 'posters': ArtRecordKind.Poster };
    
            for ( let key of Object.keys( keys ) ) {
                const kind : ArtRecordKind = keys[ key ];
    
                for ( let art of rawMovie[ key ] ) {
                    artwork.push( {
                        url: await this.getArtPath( art.file_path, 'original',  ),
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
        }, cache );
    }

    getMovieExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return this.getExternal( external, [ MediaKind.Movie ], cache ) as Promise<MovieMediaRecord>;
    }

    getMovie ( id : string, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return this.runCachedTask<MovieMediaRecord>( 'getMovie', id, async () => {
            const rawMovie = await this.moviedb.movie( { id: id } );

            const releaseDates = await this.moviedb.movieRelease_dates( { id: id } );

            return this.factory.createMovieMediaRecord( rawMovie, releaseDates.results );
        }, cache );
    }

    getTvShowArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return Promise.resolve( [] );
    }

    getTvShow ( id : string, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        throw new Error("Method not implemented.");
    }

    getTvShowExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvShow ], cache ) as Promise<TvShowMediaRecord>;
    }

    getTvShowSeasons ( id : string, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord[]> {
        throw new Error("Method not implemented.");
    }

    getTvShowSeason ( id : string, season : number, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        throw new Error("Method not implemented.");
    }

    getTvShowEpisodes ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        throw new Error("Method not implemented.");
    }

    getTvShowEpisode ( id : string, season : number, episode : number, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        throw new Error("Method not implemented.");
    }

    getTvSeason ( id : string, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        throw new Error("Method not implemented.");
    }

    getTvSeasonExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvSeason ], cache ) as Promise<TvSeasonMediaRecord>;
    }

    getTvSeasonEpisodes ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        throw new Error("Method not implemented.");
    }

    getTvEpisode ( id : string, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        throw new Error("Method not implemented.");
    }

    getTvEpisodeExternal ( external : ExternalReferences, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        return this.getExternal( external, [ MediaKind.TvEpisode ], cache ) as Promise<TvEpisodeMediaRecord>;
    }


    async getTvSeasonArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]> { return [] }

    async getTvEpisodeArt ( id : string, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]> { return [] }

    getMediaArt ( record : MediaRecord, kind ?: ArtRecordKind, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const id = record.external.moviedb;

        if ( !id ) {
            return Promise.resolve( [] );
        }

        if ( record.kind === MediaKind.Movie ) {
            return this.getMovieArt( id, kind, cache );
        } else if ( record.kind === MediaKind.TvShow ) {
            return this.getTvShowArt( id, kind, cache );
        } else if ( record.kind === MediaKind.TvSeason ) {
            return this.getTvSeasonArt( id, kind, cache );
        } else if ( record.kind === MediaKind.TvEpisode ) {
            return this.getTvEpisodeArt( id, kind, cache );
        }
    }


    /* Searching Media */
    searchMovie ( name : string, limit : number = 5, cache ?: CacheOptions ) : Promise<MovieMediaRecord[]> {
        return this.runCachedTask<MovieMediaRecord[]>( 'searchMovie', '' + limit + '|' + name, async () => {
            const yearMatch = name.match( /(\(?((?:19[0-9]|20[01])[0-9])\))$/i );

            const year = yearMatch ? yearMatch[ 2 ] : void 0;

            const title = yearMatch ? name.substring( 0, yearMatch.index - 1 ) : name;

            const rawMovie = await this.moviedb.searchMovie( { query: title, year: year } );

            // If searching for the movie with the year parameter returns not results, try searching only with the title
            if ( rawMovie.results.length == 0 && typeof year === 'number' ) {
                return this.searchMovie( title, limit, cache );
            }

            return Promise.all( rawMovie.results.slice( 0, limit ).map( movie => this.getMovie( movie.id, cache ) ) as any[] );
        }, cache );
    }

    searchTvShow ( name : string, limit ?: number, cache ?: CacheOptions ) : Promise<TvShowMediaRecord[]> {
        throw new Error("Method not implemented.");
    }
}