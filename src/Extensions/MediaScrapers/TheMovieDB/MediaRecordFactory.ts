import { MovieMediaRecord, MediaKind, RoleRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord } from "../../../MediaRecord";
import {
    MovieDBCast, MovieDBCastMovie, MovieDBCastShowAggregate,
    MovieDBEpisodeExternals,
    MovieDBMovie,
    MovieDBMovieReleaseDate,
    MovieDBSeason,
    MovieDBSeasonEpisode,
    MovieDBShow,
    MovieDBShowExternals,
    MovieDBShowRatings,
    MovieDBShowSeason
} from './Responses';
import { TheMovieDB } from './TheMovieDB';
import * as sortBy from 'sort-by';

function stringNotEmpty ( string : string ) : boolean {
    return string != void 0 && string != null && string != '';
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

    static toTvSeasonId ( tvShowId: string, seasonNumber: number ): string {
        return `SEASON/${tvShowId}/${seasonNumber}`;
    }

    static toTvEpsiodeId ( tvShowId: string, seasonNumber: number, episodeNumber: number ): string {
        return `EPISODE/${tvShowId}/${seasonNumber}/${episodeNumber}`;
    }

    static fromTvSeasonId ( id: string ): [string, number] {
        if ( id == null ) {
            throw new Error( `Cannot deconstruct a null MovieDB Season Id` );
        }

        const idSegments = id.split( '/' );

        if ( idSegments.length < 3 ) {
            throw new Error( `Cannot deconstruct a MovieDB Season Id with less than 3 segments, got only ` + id );
        }

        if ( idSegments[ 0 ].localeCompare( 'season', void 0, { sensitivity: 'accent' } ) !== 0 ) {
            throw new Error( `Expected a MovieDB Season Id string, got ` + id );
        }

        const tvShowId = idSegments[ 1 ];
        const seasonNumber = parseInt( idSegments[ 2 ], 10 );

        return [ tvShowId, seasonNumber ];
    }

    static fromTvEpisodeId ( id: string ): [string, number, number] {
        if ( id == null ) {
            throw new Error( `Cannot deconstruct a null MovieDB Episode Id` );
        }

        const idSegments = id.split( '/' );

        if ( idSegments.length < 4 ) {
            throw new Error( `Cannot deconstruct a MovieDB Episode Id with less than 4 segments, got only ` + id );
        }

        if ( idSegments[ 0 ].localeCompare( 'episode', void 0, { sensitivity: 'accent' } ) !== 0 ) {
            throw new Error( `Expected a MovieDB Episode Id string, got ` + id );
        }

        const tvShowId = idSegments[ 1 ];
        const seasonNumber = parseInt( idSegments[ 2 ], 10 );
        const episodeNumber = parseInt( idSegments[ 3 ], 10 );

        return [ tvShowId, seasonNumber, episodeNumber ];
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

    createActorRoleRecord ( actor : MovieDBCastMovie | MovieDBCastShowAggregate, customOrder: number = null ) : RoleRecord {
        let character: string | null = null;
        let appearances = 0;

        if ( 'character' in actor ) {
            // Movie Cast
            character = actor.character;
        } else if ( 'roles' in actor && actor.roles != null ) {
            // TV Show Cast
            actor.roles.sort( sortBy( 'episode_count' ) );

            character = actor.roles.map( role => role.character ).join( ' / ' );

            appearances = actor.total_episode_count;
        }

        return {
            art: {
                poster: actor.profile_path ? ( this.baseImageUrl + actor.profile_path ) : null,
                thumbnail: null,
                background: null,
                banner: null,
            },
            external: {},
            scraper: this.scraper.name,
            internalId: '' + actor.id,
            name: actor.name,
            role: character,
            order: customOrder ?? actor.order,
            appearances: appearances,
            identifier: null,
            biography: null,
            birthday: null,
            deathday: null,
            naturalFrom: null,
        };
    }

    createTvShowMediaRecord ( show : MovieDBShow, externals: MovieDBShowExternals, ratings: MovieDBShowRatings ) : TvShowMediaRecord {
        const parentalRating = ratings?.results?.find( r => r.iso_3166_1 == 'US' ) ?? ratings?.results[0];

        const year = show.first_air_date
            ? +show.first_air_date.split( '-' )[ 0 ]
            : null;

        return {
            scraper: this.scraper.name,
            kind: MediaKind.TvShow,
            addedAt: null,
            external: {
                moviedb: '' + show.id,
                tvdb: '' + externals.tvdb_id,
                imdb: externals.imdb_id,
            },
            id: '' + show.id,
            internalId: null,
            genres: show.genres.map( g => g.name ),
            parentalRating: parentalRating?.rating ?? null,
            title: show.name,
            rating: show.vote_average,
            plot: show.overview,
            year: year,
            art: {
                background: this.baseImageUrl + show.backdrop_path,
                banner: null,
                poster: this.baseImageUrl + show.poster_path,
                thumbnail: null
            },
            episodesCount: show.number_of_episodes,
            seasonsCount: show.number_of_seasons,
        } as any;
    }

    createTvSeasonMediaRecord ( season: MovieDBShowSeason, show : TvShowMediaRecord ) : TvSeasonMediaRecord {
        const id = MediaRecordFactory.toTvSeasonId( show.id, season.season_number );

        return {
            kind: MediaKind.TvSeason,
            art: {
                poster: this.baseImageUrl + season.poster_path,
                background: null,
                banner: null,
                thumbnail: null,
                tvshow: show.art
            },

            id: id,
            internalId: null,
            scraper: this.scraper.name,

            title: `${show.title} ${ season.name }`,
            number: +season.season_number,
            tvShowId: show.id,
            external: {
                moviedb: id,
            },
            episodesCount: season.episode_count
        } as any;
    }

    public createTvEpisodeMediaRecord ( episode : MovieDBSeasonEpisode, season: MovieDBSeason, show: TvShowMediaRecord, external?: MovieDBEpisodeExternals ) : TvEpisodeMediaRecord {
        const id = MediaRecordFactory.toTvEpsiodeId( show.id, episode.season_number, episode.episode_number );
        
        const thumbnail = stringNotEmpty( episode.still_path ) 
            ?  this.baseImageUrl + episode.still_path
            : null;

        return {
            kind: MediaKind.TvEpisode,
            addedAt: null,
            art: {
                background: null,
                banner: null,
                poster: null,
                thumbnail: thumbnail,
                tvshow: show.art,
            },
            external: { 
                imdb: external?.imdb_id, 
                tvdb: '' + external?.tvdb_id,
                moviedb: id,
            },
            
            id: id,
            internalId: null,
            scraper: this.scraper.name,

            number: episode.episode_number,
            rating: episode.vote_average,
            runtime: null,
            seasonNumber: episode.season_number,
            title: episode.name,
            plot: episode.overview,
            airedAt: parseDate( episode.air_date ),
            sources: null,

            tvSeasonId: season.id,
            quality: null
        } as any;
    }
}