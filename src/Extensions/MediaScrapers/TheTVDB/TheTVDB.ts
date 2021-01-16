import { IScraper, IScraperQuery } from "../../../MediaScrapers/IScraper";
import { AsyncCache, CacheOptions, CacheStorage } from "../../../MediaScrapers/ScraperCache";
import { MovieMediaRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, ArtRecord, ArtRecordKind, MediaRecord, MediaKind, ExternalReferences, MediaCastRecord, RoleRecord } from "../../../MediaRecord";
import * as TVDB from 'node-tvdb';
import { MediaRecordFactory, getQueryBoxSet } from "./MediaRecordFactory";
import { UnicastServer } from "../../../UnicastServer";
import { Logger } from 'clui-logger';

function isObjectEmpty ( object : any ) : boolean {
    if ( typeof object !== 'object' ) {
        return true;
    }

    let value : any = void 0;

    for ( let key in object ) {
        value = object[ key ];

        if ( value !== null && value !== void 0 ) {
            return false;
        }
    }

    return true;
}

function hasObjectEmptyProperties ( object : any ) : boolean {
    let value : any = void 0;

    for ( let key in object ) {
        value = object[ key ];

        if ( value === null || value === void 0 ) {
            return true;
        }
    }

    return false;
}

function stripEmptyProperties<T>( object : T ) : Partial<T> {
    const stripped : Partial<T> = {};

    let value : any = void 0;

    for ( let key in object ) {
        value = object[ key ];

        if ( value !== null && value !== void 0 ) {
            stripped[ key ] = value;
        }
    }
    
    return stripped;
}

export class TheTVDB implements IScraper {
    server : UnicastServer;

    name : string = 'tvdb';

    logger : Logger;

    tvdb : TVDB;
    
    cache : AsyncCache<any> = new AsyncCache();

    factory : MediaRecordFactory;

    constructor ( apiKey : string ) {
        this.tvdb = new TVDB( apiKey );

        this.factory = new MediaRecordFactory( this );
    }

    onEntityInit () {
        this.logger = this.server.logger.service( `scrapers/${ this.name }` );

        this.cache.storage = new CacheStorage( this.server.storage.getPath( `cache/scrapers/${ this.name }.json` ) );

        this.cache.autoSaveDelay = 500;

        this.cache.cloneOnRetrieval = false;

        this.server.onStart.subscribe( () => this.cache.load() );
    }

    getCacheKey ( method : string, id : string ) : string {
        return `${ method }|${ id }`;
    }

    runCachedTask<T extends any> ( method : string, id : string, query : IScraperQuery, runner : () => Promise<T>, options : CacheOptions = {} ) {
        id = id + this.getQueryKey( query );

        const key = this.getCacheKey( method, id );
        
        const cached = this.cache.get<T>( key, options );
        
        if ( cached ) {
            return cached;
        }
        
        return this.cache.set<T>( key, runner(), options ).catch( err => {
            this.logger.error( method  + ' ' + id );
            
            return Promise.reject( err );
        } );
    }

    protected getExternalCacheKey ( external : ExternalReferences ) : string {
        return Object.keys( external ).sort().map( key => '' + key + '=' + external[ key ]  ).join( ',' );
    }

    protected getQueryKey ( query : IScraperQuery ) : string {
        if ( isObjectEmpty( query ) ) {
            return '';
        }

        if ( hasObjectEmptyProperties( query ) ) {
            query = stripEmptyProperties( query );
        }

        return JSON.stringify( query );
    }

    /* Retrieve Records */
    getMovieArt ( id : string, kind ?: ArtRecordKind, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return Promise.resolve( [] );
    }

    getMovie ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return Promise.resolve( null );
    }

    getMovieExternal( external : ExternalReferences, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord> {
        return Promise.resolve( null );
    }

    getTvShowAllArt ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        return this.runCachedTask<any[]>( 'getTvShowArt', id, query, async () => {
            const kinds = [ "fanart", "poster", "season", "seasonwide", "series" ];

            let art : ArtRecord[] = [];

            for ( let kind of kinds ) {
                for ( let image of await this.tvdb.getSeriesImages( id, kind ).catch( err => [] ) ) {
                    art.push( this.factory.createArtRecord( image ) );
                }
            }

            return art;
        }, cache );
    }

    async getTvShowArt ( id : string, kind ?: ArtRecordKind, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        let art = await this.getTvShowAllArt( id, query, cache );

        art = art.filter( art => art.season === null );

        if ( kind ) {
            art = art.filter( art => art.kind == kind );
        }

        return art;
    }

    getTvShow ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        return this.runCachedTask<TvShowMediaRecord>( 'getTvShow', id, query, async () => {
            const rawShow = await this.tvdb.getSeriesById( +id );

            const summary = await this.tvdb.getEpisodesSummaryBySeriesId( +id );

            const art = await this.getTvShowAllArt( id, query, cache );

            return this.factory.createTvShowMediaRecord( rawShow, summary, art, query );
        }, cache );
    }

    getTvShowExternal ( external : ExternalReferences, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord> {
        const externalString = this.getExternalCacheKey( external );

        const keysMapper : { [ key : string ] : Function } = {
            'imdb': this.tvdb.getSeriesByImdbId.bind( this.tvdb ),
            'zap2it': this.tvdb.getSeriesByZap2ItId.bind( this.tvdb ),
        };

        return this.runCachedTask<TvShowMediaRecord>( 'getTvShowExternal', externalString, query, async () => {
            if ( external[ 'tvdb' ] ) {
                return await this.getTvShow( external[ 'tvdb' ], query, cache );
            }

            for ( let source of Object.keys( external ) ) {
                if ( external[ source ] && source in keysMapper ) {
                    const fetcher = keysMapper[ source ];

                    const results = await fetcher( external[ source ] );

                    if ( results.length > 0 ) {
                        return this.getTvShow( results[ 0 ].id, query, cache );
                    }
                }
            }

            return null;
        }, cache );
    }

    getTvShowSeasons ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord[]> {
        return this.runCachedTask<TvSeasonMediaRecord[]>( 'getTvShowSeasons', id, query, async () => {
            const show = await this.getTvShow( id, query, cache );

            const summary = await this.tvdb.getEpisodesSummaryBySeriesId( +id );

            const seasons : TvSeasonMediaRecord[] = [];

            const boxSet = getQueryBoxSet( query );

            for ( let season of summary[ boxSet + 'Seasons' ] ) {
                const poster = ( await this.tvdb.getSeasonPosters( id, season ).catch( () => [] ) )[ 0 ];

                seasons.push( this.factory.createTvSeasonMediaRecord( show, season, poster ? this.factory.createArtRecord( poster ).url : null ) );
            }

            return seasons;
        }, cache );
    }

    getTvShowEpisodes ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        return this.runCachedTask<TvEpisodeMediaRecord[]>( 'getTvShowEpisodes', id, query, async () => {
            const show = await this.getTvShow( id, query, cache );

            const episodes : any[] = await this.tvdb.getEpisodesBySeriesId( id );

            return episodes.map( ep => this.factory.createTvEpisodeMediaRecord( show, ep, query ) );
        }, cache ).then( episodes => episodes.map( episode => {
            episode.airedAt = typeof episode.airedAt === 'string' ? new Date( episode.airedAt ) : episode.airedAt;

            return episode;
         } ) );
    }

    getTvShowSeason ( id : string, season : number, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        season = +season;

        const key = `${id}S${season}`;

        return this.runCachedTask<TvSeasonMediaRecord>( 'getTvShowSeason', key, query, async () => {
            const seasons = await this.getTvShowSeasons( id, query );

            return seasons.find( ep => ep.number == season );
        }, cache );
    }

    getTvShowEpisode ( id : string, season : number, episode : number, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        season = +season;
        episode = +episode;

        const key = `${id}S${season}E${episode}`;

        return this.runCachedTask<TvEpisodeMediaRecord>( 'getTvShowEpisode', key, query, async () => {
            const episodes = await this.getTvShowEpisodes( id, query, cache );

            return episodes.find( ep => ep.seasonNumber == season && ep.number == episode );
        }, cache ).then( episode => {
            episode.airedAt = typeof episode.airedAt === 'string' ? new Date( episode.airedAt ) : episode.airedAt;
            
            return episode;
        } );
    }

    async getTvSeasonArt ( id : string, kind ?: ArtRecordKind, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const [ showId, seasonNumber ] = id.split( 'S' );

        let art = await this.getTvShowAllArt( showId, query, cache );

        art = art.filter( art => art.season == +seasonNumber );

        if ( kind ) {
            art = art.filter( art => art.kind == kind );
        }

        return art;
    }

    getTvSeason ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        return this.runCachedTask<TvSeasonMediaRecord>( 'getTvSeason', id, query, async () => {
            const [ showId, seasonNumber ] = id.split( 'S' );

            const seasons = await this.getTvShowSeasons( showId, query, cache );

            return seasons.find( season => season.number == +seasonNumber );
        }, cache );
    }
    
    getTvSeasonExternal ( external : ExternalReferences, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvSeasonMediaRecord> {
        if ( external.tvdb ) {
            return this.getTvSeason( external.tvdb, query, cache );
        }

        return Promise.resolve( null );
    }

    getTvSeasonEpisodes ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord[]> {
        return this.runCachedTask<TvEpisodeMediaRecord[]>( 'getTvSeasonEpisodes', id, query, async () => {
            const [ showId, seasonNumber ] = id.split( 'S' );

            const episodes = await this.getTvShowEpisodes( showId, query, cache );

            return episodes.filter( episode => episode.seasonNumber == +seasonNumber );
        }, cache ).then( episodes => episodes.map( episode => {
            episode.airedAt = typeof episode.airedAt === 'string' ? new Date( episode.airedAt ) : episode.airedAt;

            return episode;
        } ) );
    }
    
    async getTvEpisodeArt ( id : string, kind ?: ArtRecordKind, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        if ( kind && kind != ArtRecordKind.Thumbnail ) {
            return [];
        }

        const episode = await this.getTvEpisode( id, query, cache );

        if ( !episode ) {
            return [];
        }

        return [ {
            id: episode.art.thumbnail,
            url: episode.art.thumbnail,
            kind: ArtRecordKind.Thumbnail,
            height: null,
            width: null
        } ];
    }

    getTvEpisode ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        return this.runCachedTask<TvEpisodeMediaRecord>( 'getTvEpisode', id, query, async () => {
            const episode = await this.tvdb.getEpisodeById( id, cache );

            const show = await this.getTvShow( episode.seriesId, query );

            return this.factory.createTvEpisodeMediaRecord( show, episode, query );
        }, cache ).then( episode => {
            episode.airedAt = typeof episode.airedAt === 'string' ? new Date( episode.airedAt ) : episode.airedAt;
            
            return episode;
        } );
    }
    
    getTvEpisodeExternal ( external : ExternalReferences, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvEpisodeMediaRecord> {
        if ( external.tvdb ) {
            return this.getTvEpisode( external.tvdb, query, cache );
        }

        return Promise.resolve( null );
    }


    /* Get Media Art */
    getMediaArt ( record : MediaRecord, kind ?: ArtRecordKind, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const id = record.external.tvdb;

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
    getMovieCast ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return Promise.resolve( [] );
    }

    getTvShowCast ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return this.runCachedTask<RoleRecord[]>( 'getTvShowCast', id, query, async () => {
            const actors : any[] = await this.tvdb.getActors( id ).catch( () => [] );

            return actors.map( actor => this.factory.createActorRoleRecord( actor ) );
        }, cache );
    }

    getTvSeasonCast ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return Promise.resolve( [] );
    }

    getTvEpisodeCast ( id : string, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        return Promise.resolve( [] );
    }

    getMediaCast ( record : MediaRecord, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
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

    /* Search Records */
    searchMovie ( name : string, limit : number = 5, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<MovieMediaRecord[]> {
        return Promise.resolve( [] );
    }

    searchTvShow ( name : string, limit : number = 5, query : IScraperQuery = {}, cache ?: CacheOptions ) : Promise<TvShowMediaRecord[]> {
        return this.runCachedTask<TvShowMediaRecord[]>( 'searchTvShow', '' + limit + '|' + name, query, async () => {
            const shows : TvShowMediaRecord[] = [];
            
            const matches = await this.tvdb.getSeriesByName( name ).catch( () => [] );

            for ( let show of matches.slice( 0, limit ) ) {
                try {
                    shows.push( await this.getTvShow( show.id ) );
                } catch ( err ) { 
                    this.server.onError.notify( err );
                }
            }

            return shows;
        }, cache );
    }
}
