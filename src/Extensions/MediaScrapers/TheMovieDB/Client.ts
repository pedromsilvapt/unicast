import { Mutex, Semaphore, SemaphoreLike, SemaphoreRelease } from 'data-semaphore';
import { Future } from '@pedromsilva/data-future';
import { isBefore } from 'date-fns';
import * as got from 'got';

export interface ThrottleOptions {
    rate: number;
    ratePer: number;
    concurrent: number;
}

export class Throttle implements SemaphoreLike {
    public options : ThrottleOptions;
    
    public get isLocked (): boolean {
        return this.concurrentSemaphore.isLocked || this.counter >= this.options.rate;
    }

    public concurrentSemaphore: Semaphore;

    public throttleFuture: Future<void> | null = null;;

    public counter: number = 0;

    public timeout: unknown = null;

    public constructor ( options: ThrottleOptions ) {
        this.options = options;

        if ( this.options.concurrent < Infinity ) {
            this.concurrentSemaphore = new Semaphore( this.options.concurrent );
        }
    }

    async acquire (): Promise<SemaphoreRelease> {
        while ( this.counter >= this.options.rate ) {
            if ( this.throttleFuture == null ) {
                this.throttleFuture = new Future(); 
            }

            await this.throttleFuture.promise;
        }

        if ( this.counter === 0 && this.timeout == null && this.options.rate < Infinity && this.options.ratePer < Infinity ) {
            this.timeout = setTimeout( () => {
                this.timeout = null;

                this.counter = 0;

                const future = this.throttleFuture;
                
                this.throttleFuture = null;

                future?.resolve();
            }, this.options.ratePer );
        }

        this.counter += 1;

        if ( this.concurrentSemaphore != null ) {
            await this.concurrentSemaphore.acquire();
        }

        return () => this.release();
    }
    
    release (): void {
        if ( this.concurrentSemaphore != null ) {
            this.concurrentSemaphore.release();
        }
    }

    async use<T> ( fn: () => T | PromiseLike<T> ): Promise<T> {
        try {
            await this.acquire();

            return await fn();
        } finally {
            this.release();
        }
    }
}

export interface ClientOptions {
    apiKey: string;
    loadMethods?: boolean;
    baseUrl?: string;
    throttle?: Partial<ThrottleOptions>;
}

export interface ClientToken {
    success: boolean;
    expiresAt?: Date;
    requestToken?: string;
}

export class Client {
    public baseUrl: string = 'https://api.themoviedb.org/3';

    public apiKey: string;

    public loadMethods: boolean = true;

    protected loadedMethods: boolean = false;

    protected methods: Map<string, ClientEndpoint> = new Map();

    public readonly throttle : Throttle;

    public token : ClientToken | null = null;

    public tokenSemaphore : Mutex = new Mutex();

    constructor ( options: ClientOptions ) {
        this.apiKey = options.apiKey;

        if ( 'loadMethods' in options && typeof options.loadMethods === 'boolean' ) {
            this.loadMethods = options.loadMethods;
        }

        if ( 'baseUrl' in options && typeof options.baseUrl === 'string' ) {
            this.baseUrl = options.baseUrl;
        }

        if ( this.loadMethods ) {
            this.loadClientMethods();
        }

        this.throttle = new Throttle( {
            rate: options.throttle?.rate ?? 40,
            ratePer: options.throttle?.ratePer ?? 10000,
            concurrent: options.throttle?.concurrent ?? 20,
        } );
    }

    public loadClientMethods () {
        if ( this.loadedMethods ) {
            return;
        }

        this.loadedMethods = true;

        for ( const endpoint of ClientEndpoints ) {
            this.methods.set( endpoint.method, endpoint );
        }
    }

    public async getToken () {
        await this.tokenSemaphore.acquire();
        
        if ( this.token != null && isBefore(this.token.expiresAt, Date.now()) ) {
            return;
        }

        await this.throttle.acquire();

        try {
            const response = await got.get( this.baseUrl + '/authentication/token/new', {
                json: true,
                query: { 'api_key': this.apiKey },
                headers: {
                    'Accept': 'application/json'
                }
            } );

            if ( response.body.success ) {
                this.token = {
                    success: true,
                    expiresAt: new Date( response.body.expires_at ),
                    requestToken: response.body.requestToken,
                };
            } else {
                throw response.body;
            }
        } finally {
            this.throttle.release();

            this.tokenSemaphore.release();
        }
    }

    public async request<T = any> ( url: string, type: "GET" | "POST", data: any ) : Promise<T> {
        if ( this.token == null ) {
            await this.getToken();
        }

        const urlKeys: string[] = [];

        const transformedUrl = url.replace( /\{(\w*)\}/g, (match, group) => {
            urlKeys.push( group );

            return data[ group ];
        } );

        const transformedData: any = {};

        for ( const key of Object.keys( data ) ) {
            if ( urlKeys.includes( key ) ) {
                continue;
            }

            transformedData[ key ] = data[ key ];
        }

        await this.throttle.acquire();
        
        try {
            const response = await got( this.baseUrl + transformedUrl, {
                method: type.toLowerCase(),
                headers: {
                    'Accept': 'application/json'
                },
                query: { 
                    'api_key': this.apiKey,
                    ...(type == 'GET' ? transformedData : {})
                },
                body: type == 'POST' ? transformedData : null,
                json: true,
            } );
    
            return response.body as T;
        } finally {
            this.throttle.release();
        }
    }

    public async call<T = any> ( method: string | ClientEndpoint, data: any ) {
        if ( typeof method === 'string' ) {
            if ( !this.methods.has( method ) ) {
                throw new Error( `Unknown MovieDB Client Method: ${ method }` );
            }
            
            method = this.methods.get( method );
        }

        return this.request<T>( method.url, method.type, data );
    }
}

export interface ClientEndpoint {
    type: "GET" | "POST";
    url: string;
    method: string;
}

/**
 * List of endpoints taken from https://github.com/leviwheatcroft/moviedb-api/blob/master/apib/endpoints.json
 */
export const ClientEndpoints: ClientEndpoint[] = [
    {
        "type": "GET",
        "url": "/configuration",
        "method": "configuration"
    },
    {
        "type": "GET",
        "url": "/account",
        "method": "account"
    },
    {
        "type": "GET",
        "url": "/account/{id}/lists",
        "method": "accountLists"
    },
    {
        "type": "GET",
        "url": "/account/{id}/favorite/movies",
        "method": "accountFavoriteMovies"
    },
    {
        "type": "GET",
        "url": "/account/{id}/favorite/tv",
        "method": "accountFavoriteTv"
    },
    {
        "type": "POST",
        "url": "/account/{id}/favorite",
        "method": "accountFavorite"
    },
    {
        "type": "GET",
        "url": "/account/{id}/rated/movies",
        "method": "accountRatedMovies"
    },
    {
        "type": "GET",
        "url": "/account/{id}/rated/tv",
        "method": "accountRatedTv"
    },
    {
        "type": "GET",
        "url": "/account/{id}/rated/tv/episodes",
        "method": "accountRatedTvEpisodes"
    },
    {
        "type": "GET",
        "url": "/account/{id}/watchlist/movies",
        "method": "accountWatchlistMovies"
    },
    {
        "type": "GET",
        "url": "/account/{id}/watchlist/tv",
        "method": "accountWatchlistTv"
    },
    {
        "type": "POST",
        "url": "/account/{id}/watchlist",
        "method": "accountWatchlist"
    },
    {
        "type": "GET",
        "url": "/authentication/token/new",
        "method": "authenticationTokenNew"
    },
    {
        "type": "GET",
        "url": "/authentication/token/validate_with_login",
        "method": "authenticationTokenValidate_with_login"
    },
    {
        "type": "GET",
        "url": "/authentication/session/new",
        "method": "authenticationSessionNew"
    },
    {
        "type": "GET",
        "url": "/authentication/guest_session/new",
        "method": "authenticationGuest_sessionNew"
    },
    {
        "type": "GET",
        "url": "/certification/movie/list",
        "method": "certificationMovieList"
    },
    {
        "type": "GET",
        "url": "/certification/tv/list",
        "method": "certificationTvList"
    },
    {
        "type": "GET",
        "url": "/movie/changes",
        "method": "movieChanges"
    },
    {
        "type": "GET",
        "url": "/person/changes",
        "method": "personChanges"
    },
    {
        "type": "GET",
        "url": "/tv/changes",
        "method": "tvChanges"
    },
    {
        "type": "GET",
        "url": "/collection/{id}",
        "method": "collection"
    },
    {
        "type": "GET",
        "url": "/collection/{id}/images",
        "method": "collectionImages"
    },
    {
        "type": "GET",
        "url": "/company/{id}",
        "method": "company"
    },
    {
        "type": "GET",
        "url": "/company/{id}/movies",
        "method": "companyMovies"
    },
    {
        "type": "GET",
        "url": "/credit/{credit_id}",
        "method": "credit"
    },
    {
        "type": "GET",
        "url": "/discover/movie",
        "method": "discoverMovie"
    },
    {
        "type": "GET",
        "url": "/discover/tv",
        "method": "discoverTv"
    },
    {
        "type": "GET",
        "url": "/find/{id}",
        "method": "find"
    },
    {
        "type": "GET",
        "url": "/genre/movie/list",
        "method": "genreMovieList"
    },
    {
        "type": "GET",
        "url": "/genre/tv/list",
        "method": "genreTvList"
    },
    {
        "type": "GET",
        "url": "/genre/{id}/movies",
        "method": "genreMovies"
    },
    {
        "type": "GET",
        "url": "/guest_session/{guest_session_id}/rated/movies",
        "method": "guest_sessionRatedMovies"
    },
    {
        "type": "GET",
        "url": "/guest_session/{guest_session_id}/rated/tv",
        "method": "guest_sessionRatedTv"
    },
    {
        "type": "GET",
        "url": "/guest_session/{guest_session_id}/rated/tv/episodes",
        "method": "guest_sessionRatedTvEpisodes"
    },
    {
        "type": "GET",
        "url": "/job/list",
        "method": "jobList"
    },
    {
        "type": "GET",
        "url": "/keyword/{id}",
        "method": "keyword"
    },
    {
        "type": "GET",
        "url": "/keyword/{id}/movies",
        "method": "keywordMovies"
    },
    {
        "type": "GET",
        "url": "/list/{id}",
        "method": "list"
    },
    {
        "type": "GET",
        "url": "/list/{id}/item_status",
        "method": "listItem_status"
    },
    {
        "type": "POST",
        "url": "/list",
        "method": "list"
    },
    {
        "type": "POST",
        "url": "/list/{id}/add_item",
        "method": "listAdd_item"
    },
    {
        "type": "POST",
        "url": "/list/{id}/remove_item",
        "method": "listRemove_item"
    },
    {
        "type": "POST",
        "url": "/list/{id}/clear",
        "method": "listClear"
    },
    {
        "type": "GET",
        "url": "/movie/{id}",
        "method": "movie"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/account_states",
        "method": "movieAccount_states"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/alternative_titles",
        "method": "movieAlternative_titles"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/credits",
        "method": "movieCredits"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/images",
        "method": "movieImages"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/keywords",
        "method": "movieKeywords"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/release_dates",
        "method": "movieRelease_dates"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/videos",
        "method": "movieVideos"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/translations",
        "method": "movieTranslations"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/similar",
        "method": "movieSimilar"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/reviews",
        "method": "movieReviews"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/lists",
        "method": "movieLists"
    },
    {
        "type": "GET",
        "url": "/movie/{id}/changes",
        "method": "movieChanges"
    },
    {
        "type": "POST",
        "url": "/movie/{id}/rating",
        "method": "movieRating"
    },
    {
        "type": "GET",
        "url": "/movie/latest",
        "method": "movieLatest"
    },
    {
        "type": "GET",
        "url": "/movie/now_playing",
        "method": "movieNow_playing"
    },
    {
        "type": "GET",
        "url": "/movie/popular",
        "method": "moviePopular"
    },
    {
        "type": "GET",
        "url": "/movie/top_rated",
        "method": "movieTop_rated"
    },
    {
        "type": "GET",
        "url": "/movie/upcoming",
        "method": "movieUpcoming"
    },
    {
        "type": "GET",
        "url": "/network/{id}",
        "method": "network"
    },
    {
        "type": "GET",
        "url": "/person/{id}",
        "method": "person"
    },
    {
        "type": "GET",
        "url": "/person/{id}/movie_credits",
        "method": "personMovie_credits"
    },
    {
        "type": "GET",
        "url": "/person/{id}/tv_credits",
        "method": "personTv_credits"
    },
    {
        "type": "GET",
        "url": "/person/{id}/combined_credits",
        "method": "personCombined_credits"
    },
    {
        "type": "GET",
        "url": "/person/{id}/external_ids",
        "method": "personExternal_ids"
    },
    {
        "type": "GET",
        "url": "/person/{id}/images",
        "method": "personImages"
    },
    {
        "type": "GET",
        "url": "/person/{id}/tagged_images",
        "method": "personTagged_images"
    },
    {
        "type": "GET",
        "url": "/person/{id}/changes",
        "method": "personChanges"
    },
    {
        "type": "GET",
        "url": "/person/popular",
        "method": "personPopular"
    },
    {
        "type": "GET",
        "url": "/person/latest",
        "method": "personLatest"
    },
    {
        "type": "GET",
        "url": "/review/{id}",
        "method": "review"
    },
    {
        "type": "GET",
        "url": "/search/company",
        "method": "searchCompany"
    },
    {
        "type": "GET",
        "url": "/search/collection",
        "method": "searchCollection"
    },
    {
        "type": "GET",
        "url": "/search/keyword",
        "method": "searchKeyword"
    },
    {
        "type": "GET",
        "url": "/search/list",
        "method": "searchList"
    },
    {
        "type": "GET",
        "url": "/search/movie",
        "method": "searchMovie"
    },
    {
        "type": "GET",
        "url": "/search/multi",
        "method": "searchMulti"
    },
    {
        "type": "GET",
        "url": "/search/person",
        "method": "searchPerson"
    },
    {
        "type": "GET",
        "url": "/search/tv",
        "method": "searchTv"
    },
    {
        "type": "GET",
        "url": "/timezones/list",
        "method": "timezonesList"
    },
    {
        "type": "GET",
        "url": "/tv/{id}",
        "method": "tv"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/account_states",
        "method": "tvAccount_states"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/alternative_titles",
        "method": "tvAlternative_titles"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/changes",
        "method": "tvChanges"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/content_ratings",
        "method": "tvContent_ratings"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/credits",
        "method": "tvCredits"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/external_ids",
        "method": "tvExternal_ids"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/images",
        "method": "tvImages"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/keywords",
        "method": "tvKeywords"
    },
    {
        "type": "POST",
        "url": "/tv/{id}/rating",
        "method": "tvRating"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/similar",
        "method": "tvSimilar"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/translations",
        "method": "tvTranslations"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/videos",
        "method": "tvVideos"
    },
    {
        "type": "GET",
        "url": "/tv/latest",
        "method": "tvLatest"
    },
    {
        "type": "GET",
        "url": "/tv/on_the_air",
        "method": "tvOn_the_air"
    },
    {
        "type": "GET",
        "url": "/tv/airing_today",
        "method": "tvAiring_today"
    },
    {
        "type": "GET",
        "url": "/tv/top_rated",
        "method": "tvTop_rated"
    },
    {
        "type": "GET",
        "url": "/tv/popular",
        "method": "tvPopular"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}",
        "method": "tvSeason"
    },
    {
        "type": "GET",
        "url": "/tv/season/{id}/changes",
        "method": "tvSeasonChanges"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/account_states",
        "method": "tvSeasonAccount_states"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/credits",
        "method": "tvSeasonCredits"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/external_ids",
        "method": "tvSeasonExternal_ids"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/images",
        "method": "tvSeasonImages"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/videos",
        "method": "tvSeasonVideos"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}",
        "method": "tvSeasonEpisode"
    },
    {
        "type": "GET",
        "url": "/tv/episode/{id}/changes",
        "method": "tvEpisodeChanges"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/account_states",
        "method": "tvSeasonEpisodeAccount_states"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/credits",
        "method": "tvSeasonEpisodeCredits"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/external_ids",
        "method": "tvSeasonEpisodeExternal_ids"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/images",
        "method": "tvSeasonEpisodeImages"
    },
    {
        "type": "POST",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/rating",
        "method": "tvSeasonEpisodeRating"
    },
    {
        "type": "GET",
        "url": "/tv/{id}/season/{season_number}/episode/{episode_number}/videos",
        "method": "tvSeasonEpisodeVideos"
    }
];