import { MovieMediaRecord, MediaKind, RoleRecord } from "../../../MediaRecord";
import { TheMovieDB } from './TheMovieDB';

export interface MovieDBMovie {
    adult: boolean;
    backdrop_path: string;
    belongs_to_collection: { 
        id: number;
        name: string;
        poster_path: string;
        backdrop_path: string;
    };
    budget: number;
    genres: { id: number, name: string }[];
    homepage: string;
    id: number;
    imdb_id: string;
    original_language: string;
    original_title: string;
    overview: string;
    popularity: number;
    poster_path: string;
    production_companies:{ 
        id: number;
        logo_path: string;
        name: string;
        origin_country: string 
    }[];
    production_countries: { iso_3166_1: string; name: string }[];
    release_date: string;
    revenue: number;
    runtime: number;
    spoken_languages: { iso_639_1: string; name: string }[];
    status: string;
    tagline: string;
    title: string;
    video: boolean;
    vote_average: number;
    vote_count: number;
}

export interface MovieDBMovieReleaseDate {
    iso_3166_1: string;
    release_dates: { 
        certification: string;
        iso_639_1: string;
        note: string;
        release_date: string;
        type: number;
    }[];
}

export function parseDate ( data : string ) : Date {
    if ( !data ) {
        return null;
    }

    const parts = data.split( '-' );

    return new Date( +parts[ 0 ], +parts[ 1 ] - 1, +parts[ 2 ] );
}

export class MediaRecordFactory {
    scraper : TheMovieDB;
    
    baseImageUrl : string = 'https://image.tmdb.org/t/p/original';

    constructor ( scraper : TheMovieDB ) {
        this.scraper = scraper;
    }

    createMovieMediaRecord ( movie : MovieDBMovie, releaseDates : MovieDBMovieReleaseDate[] ) : MovieMediaRecord {
        const year = movie.release_date
            ? +movie.release_date.split( '-' )[ 0 ]
            : null;

        const preferedCountries = [ 'US', 'PT', 'FR', 'GB', 'AU', 'ES' ];

        const release = preferedCountries
            .map( id => releaseDates.find( rl => rl.iso_3166_1 == id ) )
            .filter( rl => rl != null )
            .find( rl => {
                rl.release_dates = rl.release_dates.filter( date => date.certification != '' )

                return rl.release_dates.length > 0;
            } );

        const parentalRating = release ? release.release_dates[ 0 ].certification : null;

        return {
            scraper: this.scraper.name,
            kind: MediaKind.Movie,
            addedAt: null,
            external: {
                imdb: movie.imdb_id,
                moviedb: '' + movie.id
            },
            id: '' + movie.id,
            internalId: null,
            genres: movie.genres.map( g => g.name ),
            parentalRating: parentalRating,
            title: movie.title,
            rating: movie.vote_average,
            plot: movie.overview,
            year: year,
            art: {
                background: this.baseImageUrl + movie.backdrop_path,
                banner: null,
                poster: this.baseImageUrl + movie.poster_path,
                thumbnail: null
            },
            tagline: movie.tagline,
            runtime: movie.runtime * 60,
            trailer: null,
        } as any;
    }

    createActorRoleRecord ( actor : any ) : RoleRecord {
        return {
            art: {
                poster: actor.profile_path ? ( this.baseImageUrl + actor.profile_path ) : null,
                thumbnail: null,
                background: null,
                banner: null,
            },
            internalId: actor.id,
            name: actor.name,
            role: actor.character,
            order: actor.order,
            biography: null,
            birthday: null,
            deathday: null,
            naturalFrom: null,
        }
    }
}