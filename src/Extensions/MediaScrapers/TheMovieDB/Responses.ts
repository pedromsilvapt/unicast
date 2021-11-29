
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

export interface MovieDBShowExternals {
    imdb_id?: string;
    freebase_mid?: string;
    freebase_id?: string;
    tvdb_id?: number;
    tvrage_id?: number;
    facebook_id?: string;
    instagram_id?: string;
    twitter_id?: string;
    id: number;
}

export interface MovieDBShowRatings {
    results: {
        iso_3166_1: string;
        rating: string;
    }[];
    id: number;
}

export interface MovieDBShow {
    backdrop_path: string;
    created_by: {
        id: number;
        credit_id: string;
        name: string;
        gender: number;
        profile_path: string;
    }[];
    episode_run_time: number[];
    first_air_date: string;
    genres: {
        id: number;
        name: string;
    }[];
    homepage: string;
    id: number;
    in_production: boolean;
    languages: string[];
    last_air_date: string;
    last_episode_to_air: {
        air_date: string;
        episode_number: number;
        id: number;
        name: string;
        overview: string;
        production_code: string;
        season_number: number;
        still_path: string;
        vote_average: number;
        vote_count: number;
    };
    name: string;
    next_episode_to_air: null;
    networks: {
        name: string;
        id: number;
        logo_path: null | string;
        origin_country: string;
    }[];
    number_of_episodes: number;
    number_of_seasons: number;
    origin_country: string[];
    original_language: string;
    original_name: string;
    overview: string;
    popularity: number;
    poster_path: string;
    production_companies: {
        name: string;
        id: number;
        logo_path: null | string;
        origin_country: string;
    }[];
    production_countries: {
        iso_3166_1: string;
        name: string;
    }[];
    seasons: {
        air_date: string;
        episode_count: number;
        id: number;
        name: string;
        overview: string;
        poster_path: string;
        season_number: number;
    }[];
    spoken_languages: {
        english_name: string;
        iso_639_1: string;
        name: string;
    }[];
    status: string;
    tagline: string;
    type: string;
    vote_average: number;
    vote_count: number;
}

type MovieDBShowSeasonInfer = MovieDBShow['seasons'][0];
export interface MovieDBShowSeason extends MovieDBShowSeasonInfer {}

export interface MovieDBSeason {
    _id: string;
    air_date: string;
    episodes: {
        air_date: string;
        episode_number: number;
        crew: {
            department?: Department;
            job?: Job;
            credit_id: string;
            adult: boolean;
            gender: number;
            id: number;
            known_for_department: Department;
            name: string;
            original_name: string;
            popularity: number;
            profile_path: null | string;
            order?: number;
            character?: string;
        }[];
        guest_stars: {
            department?: Department;
            job?: Job;
            credit_id: string;
            adult: boolean;
            gender: number;
            id: number;
            known_for_department: Department;
            name: string;
            original_name: string;
            popularity: number;
            profile_path: null | string;
            order?: number;
            character?: string;
        }[];
        id: number;
        name: string;
        overview: string;
        production_code: string;
        season_number: number;
        still_path: string;
        vote_average: number;
        vote_count: number;
    }[];
    name: string;
    overview: string;
    id: number;
    poster_path: string;
    season_number: number;
}

type MovieDBSeasonEpisodeInfer = MovieDBSeason['episodes'][0];
export interface MovieDBSeasonEpisode extends MovieDBSeasonEpisodeInfer {}

// TODO Keep the enums (find actual possible vaues) or replace them with simple strings?
export enum Department {
    Acting = "Acting",
    Camera = "Camera",
    Creator = "Creator",
    Directing = "Directing",
    Editing = "Editing",
    Production = "Production",
    Writing = "Writing",
}

export enum Job {
    Director = "Director",
    DirectorOfPhotography = "Director of Photography",
    Editor = "Editor",
    Writer = "Writer",
}

export interface MovieDBEpisode {
    air_date: string;
    crew: {
        id: number;
        credit_id: string;
        name: string;
        department: string;
        job: string;
        profile_path: null | string;
    }[];
    episode_number: number;
    guest_stars: {
        id: number;
        name: string;
        credit_id: string;
        character: string;
        order: number;
        profile_path: string;
    }[];
    name: string;
    overview: string;
    id: number;
    production_code: string;
    season_number: number;
    still_path: string;
    vote_average: number;
    vote_count: number;
}

export interface MovieDBEpisodeExternals {
    imdb_id?: string;
    freebase_mid?: string;
    freebase_id?: string;
    tvdb_id?: number;
    tvrage_id?: number;
    id: number;
}
