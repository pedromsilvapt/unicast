import { MovieMediaRecord, MediaKind } from "../../MediaRecord";

/*     adult: boolean,
        backdrop_path: '/phszHPFVhPHhMZgo0fWTKBDQsJA.jpg',
        belongs_to_collection:
         { id: 8945,
           name: 'Mad Max Collection',
           poster_path: '/jZowUf4okNYuSlgj5iURE7CDMho.jpg',
           backdrop_path: '/zI0q2ENcQOLECbe0gAEGlncVh2j.jpg' },
        budget: 150000000,
        genres:
         [ { id: 28, name: 'Action' },
           { id: 12, name: 'Adventure' },
           { id: 878, name: 'Science Fiction' },
           { id: 53, name: 'Thriller' } ],
        homepage: 'http://www.madmaxmovie.com/',
        id: 76341,
        imdb_id: 'tt1392190',
        original_language: 'en',
        original_title: 'Mad Max: Fury Road',
        overview:
         'An apocalyptic story set in the furthest reaches of our planet, in a stark desert landscape where humanity is broken, and most everyone is crazed fighting for the necessities of life. Within this world exist two rebels on the run who just might be able to restore order. There\'s Max, a man of action and a man of few words, who seeks peace of mind following the loss of his wife and child in the aftermath of the chaos. And Furiosa, a woman of action and a woman who believes her path to survival may be achieved if she can make it across the desert back to her childhood homeland.',
        popularity: 28.462,
        poster_path: '/kqjL17yufvn9OVLyXYpvtyrFfak.jpg',
        production_companies:
         [ { id: 79,
             logo_path: '/tpFpsqbleCzEE2p5EgvUq6ozfCA.png',
             name: 'Village Roadshow Pictures',
             origin_country: 'US' },
           { id: 2537,
             logo_path: null,
             name: 'Kennedy Miller Productions',
             origin_country: 'AU' },
           { id: 174,
             logo_path: '/ky0xOc5OrhzkZ1N6KyUxacfQsCk.png',
             name: 'Warner Bros. Pictures',
             origin_country: 'US' } ],
        production_countries:
         [ { iso_3166_1: 'AU', name: 'Australia' },
           { iso_3166_1: 'US', name: 'United States of America' } ],
        release_date: '2015-05-13',
        revenue: 378858340,
        runtime: 120,
        spoken_languages: [ { iso_639_1: 'en', name: 'English' } ],
        status: 'Released',
        tagline: 'What a Lovely Day.',
        title: 'Mad Max: Fury Road',
        video: false,
        vote_average: 7.4,
        vote_count: 12308 */

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
            runtime: movie.runtime,
            trailer: null,
        } as any;
    }
}