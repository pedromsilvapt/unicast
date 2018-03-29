import * as got                   from 'got';
import { MediaQuery } from "../BaseRepository/IMediaRepository";
// import { Semaphore } from 'await-semaphore';
import { Semaphore, Batched } from 'data-semaphore';
import { Optional } from 'data-optional';

export class KodiApi {
    protected semaphore : Semaphore = new Semaphore( 4 );

    protected _available : Optional<boolean> = Optional.empty();

    address : string;

    port : number;

    protected movieFieldsList : string[] = [ 
        'title', 'art', 'rating', 'thumbnail', 'playcount', 'file', 'dateadded', 'lastplayed', 'imdbnumber', 'trailer',
        'genre', 'plot', 'tagline', 'year', 'mpaa', 'runtime'
    ];

    protected tvShowFieldsList : string[] = [ 
        'title', 'art', 'genre', 'plot', 'year', 'rating', 'thumbnail', 'playcount', 'file', 'fanart',
        'imdbnumber', 'watchedepisodes', 'episode', 'season', 'mpaa', 'dateadded'
    ];

    protected tvSeasonFieldsList : string[] = [
        'art', 'episode', 'season', 'tvshowid', 'watchedepisodes'
    ];

    protected tvEpisodeFieldsList : string[] = [
        'title', 'episode', 'playcount', 'season', 'file', 'dateadded',
        'firstaired', 'art', 'runtime', 'lastplayed', 'plot', 'rating'
    ]

    constructor ( address : string = 'localhost', port : number = 8008 ) {
        this.address = address;
        this.port = port;
    }

    get endpoint () : string {
        return `http://${ this.address }:${ this.port }/jsonrpc`;
    }

    async sync () {
        return this.query( {
            'method': 'VideoLibrary.Scan',
            'params': {}
        } );
    }

    @Batched()
    async available () : Promise<boolean> {
        if ( this._available.isPresent() ) {
            return this._available.get();
        }

        try {
            await this.ping();

            this._available = Optional.of( true );

            return true;
        } catch ( error ) {
            this._available = Optional.of( false );
            
            return false;
        }
    }

    async query<R = any> ( query : any, kind : string = null, options : any = {} ) : Promise<R> {
        const release = await this.semaphore.acquire();

        try {
            let response = await got( this.endpoint, {
                json: false,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify( {
                    'jsonrpc': '2.0',
                    'id': 1,
                    ...query
                } )
            } );
    
            if ( !kind || options.returnResponse ) {
                return response;
            } else if ( !kind ) {
                return response.body;
            }
    
            const body = JSON.parse( response.body );
    
            if ( body.error ) {
                console.log( query );
                throw new Error( body.error.message );
            }
    
            if ( body.result.limits ) {
                if ( body.result.limits.start >= body.result.limits.total ) {
                    return [] as any as R;
                }
            }
    
            const result = body.result[ kind + 's' ] || body.result[ kind + 'details' ];
    
            if ( !( result instanceof Array ) && options.forceArray ) {
                return [ result ] as any as R;
            }
    
            return result;
        } finally {
            release();
        }
    }

    async ping () : Promise<void> {
        return this.query<void>( {
            'method': 'JSONRPC.Ping'
        } );
    }

    async getEpisodes ( params : any = {} ) : Promise<TvEpisodeKodiRecord[]> {
        return this.query<TvEpisodeKodiRecord[]>( {
            'method': 'VideoLibrary.GetEpisodes',
            'params': {
                'properties': this.tvEpisodeFieldsList,
                'sort': { 'order': 'ascending', 'method': 'episode' },
                ...params
            }
        }, 'episode' );
    }
    
    async getSingleEpisode ( params : any = {} ) : Promise<TvEpisodeKodiRecord> {
        return this.query<TvEpisodeKodiRecord>( {
            'method': 'VideoLibrary.GetEpisodeDetails',
            'params': {
                'properties': this.tvEpisodeFieldsList,
                ...params
            }
        }, 'episode' );
    }
    
    async setSingleEpisode ( id : number, params : object ) : Promise<void> {
        return this.query<void>( {
            'method': 'VideoLibrary.SetEpisodeDetails',
            'params': {
                episodeid: id,
                ...params
            }
        }, 'episode' );
    }

    async getSeasons ( params : any = {} ) : Promise<TvSeasonKodiRecord[]> {
        return this.query<TvSeasonKodiRecord[]>( {
            'method': 'VideoLibrary.GetSeasons',
            'params': {
                'properties': this.tvSeasonFieldsList,
                'sort': { 'order': 'ascending', 'method': 'season' },
                ...params
            }
        }, 'season' );
    }

    async getSingleSeason ( params : any = {} ) : Promise<TvSeasonKodiRecord> {
        return this.query<TvSeasonKodiRecord>( {
            'method': 'VideoLibrary.GetSeasonDetails',
            'params': {
                'properties': this.tvSeasonFieldsList,
                ...params
            }
        }, 'season' );
    }

    async getShows ( params : any ) : Promise<TvShowKodiRecord[]> {
        return this.query<TvShowKodiRecord[]>( {
            'method': 'VideoLibrary.GetTVShows',
            'params': {
                'properties': this.tvShowFieldsList,
                'sort': { 'order': 'ascending', 'method': 'title' },
                ...params
            }
        }, 'tvshow' );
    }

    async getSingleShow ( params : any ) : Promise<TvShowKodiRecord[]> {
        return this.query<TvShowKodiRecord[]>( {
            'method': 'VideoLibrary.GetTVShowDetails',
            'params': {
                'properties': this.tvShowFieldsList,
                ...params
            }
        }, 'tvshow' );
    }

    async getMovies ( params : any ) : Promise<MovieKodiRecord[]> {
        return this.query<MovieKodiRecord[]>( {
            'method': 'VideoLibrary.GetMovies',
            'params': {
                'properties': this.movieFieldsList,
                'sort': { 'order': 'ascending', 'method': 'title' },
                ...params
            }
        }, 'movie' );
    }

    async getSingleMovie ( params : any ) : Promise<MovieKodiRecord> {
        return this.query<MovieKodiRecord>( {
            'method': 'VideoLibrary.GetMovieDetails',
            'params': {
                'properties': this.movieFieldsList,
                ...params
            }
        }, 'movie' );
    }

    async setSingleMovie ( id : number, params : object ) : Promise<void> {
        return this.query<void>( {
            'method': 'VideoLibrary.SetMovieDetails',
            'params': {
                movieid: id,
                ...params
            }
        }, 'movie' );
    }
}

export interface MovieKodiRecord {
    movieid : number;
    title : string;
    art : any;
    rating : number;
    thumbnail: string;
    playcount : number;
    file : string;
    dateadded : string;
    imdbnumber : string;
    lastplayed : string;
    trailer : string;
    genre : string[];
    plot : string;
    tagline : string;
    year : number;
    mpaa : string;
}

export interface TvShowKodiRecord {
    tvshowid : number;
    title : string;
    art : any;
    genre: string[];
    plot : string;
    year : number;
    rating : number;
    thumbnail : string;
    playcount : number;
    file : string;
    fanart : string;
    imdbnumber : string;
    watchedepisodes : number;
    episode : number;
    season : number;
    mpaa : string;
    dateadded : string;
}

export interface TvSeasonKodiRecord {
    art : any;
    seasonid : number;
    episode : number;
    season : number;
    tvshowid : number;
    showtitle : string;
    watchedepisodes : number;
}

export interface TvEpisodeKodiRecord {
    episodeid : number;
    title : string;
    playcount : number;
    tvshowid : number;
    seasonid : number;
    season : number;
    episode : number;
    file : string;
    dateadded : string;
    firstaired : string;
    art : any;
    runtime: number;
    rating: number;
    lastplayed : string;
    plot : string;
}

// ( async () => {
//     const api = new KodiApi( '127.192.0.1', 8008 );
    
//     const movie = await api.getSingleMovie( {
//         movieid: 848
//     } );

//     console.log( movie );

//     console.log( await api.setSingleMovie( 848, { playcount: 1 } ) );
// } )();