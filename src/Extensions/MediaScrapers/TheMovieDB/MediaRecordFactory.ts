import { MovieMediaRecord, MediaKind } from "../../../MediaRecord";

export interface MovieDBMovie {
    adult: boolean;
    backdrop_path: string;
    belongs_to_collection: { 
        id: number;
        name: string;
        poster_path: string;
        backdrop_path: string;
    }
    budget: number;
    genres: { id: number, name: string }[];
    homepage: string;
    id: number;
    imdb_id: string;
    original_language: string,
    original_title: string,
    overview: string;
    popularity: number,
    poster_path: string,
    production_companies:{ 
        id: number,
        logo_path: string,
        name: string,
        origin_country: string 
    }[]
    production_countries: { iso_3166_1: string, name: string }[]
    release_date: string,
    revenue: number,
    runtime: number,
    spoken_languages: { iso_639_1: string, name: string }[],
    status: string,
    tagline: string,
    title: string,
    video: boolean,
    vote_average: number,
    vote_count: number
}

export interface MovieDBMovieReleaseDate {
    iso_3166_1: string;
    release_dates: { 
        certification: string,
        iso_639_1: string,
        note: string,
        release_date: string,
        type: number
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
                background: 'https://image.tmdb.org/t/p/original' + movie.backdrop_path,
                banner: null,
                poster: 'https://image.tmdb.org/t/p/original' + movie.poster_path,
                thumbnail: null
            },
            tagline: movie.tagline,
            runtime: movie.runtime * 60,
            trailer: null,
        } as any;
    }
}