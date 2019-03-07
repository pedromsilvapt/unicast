import { TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, MediaKind, ArtRecord, MediaRecordArt } from "../../../MediaRecord";
import * as sortBy from 'sort-by';
import { TheTVDB } from './TheTVDB';

export function parseDate ( data : string ) : Date {
    if ( !data ) {
        return null;
    }

    const parts = data.split( '-' );

    return new Date( +parts[ 0 ], +parts[ 1 ] - 1, +parts[ 2 ], 0, 0, 0, 0 );
}

export interface TvDbShow {
    added: string;
    airsDayOfWeek: string;
    airsTime: string;
    aliases: string[];
    banner: string;
    firstAired: string;
    genre: string[];
    id: number;
    imdbId: string;
    lastUpdated: number;
    network: string;
    networkId: string;
    overview: string;
    rating: string;
    runtime: string;
    seriesId: string;
    seriesName: string;
    siteRating: number;
    siteRatingCount: number;
    slug: string;
    status: string;
    zap2itId: string;
}

export interface TvDbEpisode {
    absoluteNumber: number;
    airedEpisodeNumber: number;
    airedSeason: number;
    airsAfterSeason: number;
    airsBeforeEpisode: number;
    airsBeforeSeason: number;
    director: string;
    directors: string[];
    dvdChapter: number;
    dvdDiscid: string;
    dvdEpisodeNumber: number;
    dvdSeason: number;
    episodeName: string;
    filename: string;
    firstAired: string;
    guestStars: string[];
    id: number;
    imdbId: string;
    lastUpdated: number;
    lastUpdatedBy: string;
    overview: string;
    productionCode: string;
    seriesId: string;
    showUrl: string;
    siteRating: number;
    siteRatingCount: number;
    thumbAdded: string;
    thumbAuthor: number;
    thumbHeight: string;
    thumbWidth: string;
    writers: string[];
}

export class MediaRecordFactory {
    scraper : TheTVDB;

    constructor ( scraper : TheTVDB ) {
        this.scraper = scraper;
    }

    createTvShowMediaRecordArt ( art : ArtRecord[] ) : MediaRecordArt {
        const poster = art.sort( ( a, b ) => sortBy( '-score' ) ).find( art => art.kind == 'poster' && typeof art.season != 'number' );
        const background = art.sort( ( a, b ) => sortBy( '-score' ) ).find( art => art.kind == 'background' && typeof art.season != 'number' );
        const banner = art.sort( ( a, b ) => sortBy( '-score' ) ).find( art => art.kind == 'banner' && typeof art.season != 'number' );

        return {
            poster: poster ? poster.url : null,
            background: background ? background.url : null,
            banner: banner ? banner.url : null,
            thumbnail: null
        };
    }

    createTvShowMediaRecord ( show : TvDbShow, summary : any, art : ArtRecord[] ) : TvShowMediaRecord {
        const year = show.firstAired
            ? +show.firstAired.split( '-' )[ 0 ]
            : null;

        return {
            scraper: this.scraper.name,
            kind: MediaKind.TvShow,
            addedAt: null,
            episodesCount: summary.airedEpisodes,
            external: {
                imdb: show.imdbId,
                zap2it: show.zap2itId,
                tvdb: '' + show.id
            },

            id: '' + show.id,
            internalId: null,
            
            genres: show.genre,
            parentalRating: show.rating,
            title: show.seriesName,
            rating: show.siteRating,
            plot: show.overview,
            year: year,
            
            art: this.createTvShowMediaRecordArt( art ),
            seasonsCount: summary.airedSeasons.filter( season => season != '0' ).length
        } as any;
    }

    createTvSeasonMediaRecord ( show : TvShowMediaRecord, number : number, poster : string ) : TvSeasonMediaRecord {
        return {
            kind: MediaKind.TvSeason,
            art: {
                poster: poster,
                background: null,
                banner: null,
                thumbnail: null,
                tvshow: show.art
            },

            id: '' + show.id + 'S' + number,
            internalId: null,

            title: `${show.title} Season ${ number }`,
            number: +number,
            tvShowId: show.id,
            external: {
                tvdb: show.external.tvdb + 'S' + number
            }
        } as any;
    }
    
    createTvEpisodeMediaRecord ( show : TvShowMediaRecord, episode : TvDbEpisode ) : TvEpisodeMediaRecord {
        const thumbnail = `https://www.thetvdb.com/banners/${ episode.filename }`;

        return {
            kind: MediaKind.TvEpisode,
            addedAt: null,
            art: {
                background: null,
                banner: null,
                poster: null,
                thumbnail: thumbnail,
                tvshow: show.art 
            },
            external: { imdb: episode.imdbId, tvdb: '' + episode.id },
            
            id: '' + episode.id,
            internalId: null,

            number: +episode.airedEpisodeNumber,
            rating: +episode.siteRating,
            runtime: null,
            seasonNumber: +episode.airedSeason,
            title: episode.episodeName,
            plot: episode.overview,
            airedAt: parseDate( episode.firstAired ),
            sources: null,

            tvSeasonId: '' + show.id + 'S' + episode.airedSeason,
            quality: null
        } as any;
    }

    createArtRecord ( art : any ) : ArtRecord {
        const [ width, heigth ] = art.resolution.split( 'x' );

        const mapping = {
            "fanart": "background",
            "poster": "poster",
            "season": "poster",
            "seasonwide": "banner",
            "series": "banner"
        }

        return {
            width: +width,
            height: +heigth,
            url: `https://www.thetvdb.com/banners/${ art.fileName }`,
            kind: mapping[ art.keyType ],
            season: art.keyType == 'season' || art.keyType == 'seasonwide' ? +art.subKey : null,
            score: art.ratingsInfo.average || 0
        };
    }
}