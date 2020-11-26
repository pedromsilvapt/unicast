import { TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, MediaKind, ArtRecord, MediaRecordArt, RoleRecord } from "../../../MediaRecord";
import * as sortBy from 'sort-by';
import { TheTVDB } from './TheTVDB';
import { IScraperQuery } from '../../../MediaScrapers/IScraper';

export function getQueryBoxSet ( query : IScraperQuery, defaultBoxSet : string = 'aired' ) : string {
    const boxSet = query?.boxSet ?? defaultBoxSet;

    if ( boxSet !== 'aired' && boxSet !== 'dvd' ) {
        throw new Error( `Invalid box set for TV show: ${ boxSet } (expected 'aired' or 'dvd').` );
    }

    return boxSet;
}

export function parseDate ( data : string ) : Date {
    if ( !data ) {
        return null;
    }

    const parts = data.split( '-' );

    return new Date( +parts[ 0 ], +parts[ 1 ] - 1, +parts[ 2 ], 0, 0, 0, 0 );
}

function stringNotEmpty ( string : string ) : boolean {
    return string != void 0 && string != null && string != '';
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

    baseImageUrl : string = 'https://www.thetvdb.com/banners/';

    constructor ( scraper : TheTVDB ) {
        this.scraper = scraper;
    }

    public createTvShowMediaRecordArt ( art : ArtRecord[] ) : MediaRecordArt {
        const poster = art.sort( sortBy( '-score' ) ).find( art => art.kind == 'poster' && typeof art.season != 'number' );
        const background = art.sort( sortBy( '-score' ) ).find( art => art.kind == 'background' && typeof art.season != 'number' );
        const banner = art.sort( sortBy( '-score' ) ).find( art => art.kind == 'banner' && typeof art.season != 'number' );

        return {
            poster: poster ? poster.url : null,
            background: background ? background.url : null,
            banner: banner ? banner.url : null,
            thumbnail: null
        };
    }

    public createTvShowMediaRecord ( show : TvDbShow, summary : any, art : ArtRecord[], query : IScraperQuery ) : TvShowMediaRecord {
        const year = show.firstAired
            ? +show.firstAired.split( '-' )[ 0 ]
            : null;

        const boxSet = getQueryBoxSet( query );

        return {
            scraper: this.scraper.name,
            kind: MediaKind.TvShow,
            addedAt: null,
            episodesCount: summary[ boxSet + 'Episodes'],
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
            seasonsCount: summary[ boxSet + 'Seasons' ].filter( season => season != '0' ).length
        } as any;
    }

    public createTvSeasonMediaRecord ( show : TvShowMediaRecord, number : number, poster : string ) : TvSeasonMediaRecord {
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
            scraper: this.scraper.name,

            title: `${show.title} Season ${ number }`,
            number: +number,
            tvShowId: show.id,
            external: {
                tvdb: show.external.tvdb + 'S' + number
            }
        } as any;
    }
    
    public createTvEpisodeMediaRecord ( show : TvShowMediaRecord, episode : TvDbEpisode, query : IScraperQuery = {} ) : TvEpisodeMediaRecord {
        const thumbnail = stringNotEmpty( episode.filename ) 
            ?  this.baseImageUrl + episode.filename
            : null;

        const boxSet = getQueryBoxSet( query );

        return {
            kind: MediaKind.TvEpisode,
            addedAt: null,
            art: {
                background: null,
                banner: null,
                poster: null,
                thumbnail: thumbnail
            },
            external: { imdb: episode.imdbId, tvdb: '' + episode.id },
            
            id: '' + episode.id,
            internalId: null,
            scraper: this.scraper.name,

            number: +episode[ boxSet + 'EpisodeNumber' ],
            rating: +episode.siteRating,
            runtime: null,
            seasonNumber: +episode[ boxSet + 'Season' ],
            title: episode.episodeName,
            plot: episode.overview,
            airedAt: parseDate( episode.firstAired ),
            sources: null,

            tvSeasonId: '' + show.id + 'S' + episode[ boxSet + 'Season' ],
            quality: null
        } as any;
    }

    public createArtRecord ( art : any ) : ArtRecord {
        const [ width, heigth ] = art.resolution.split( 'x' );

        const mapping = {
            "fanart": "background",
            "poster": "poster",
            "season": "poster",
            "seasonwide": "banner",
            "series": "banner"
        }

        const url = stringNotEmpty( art.fileName ) 
            ? this.baseImageUrl + art.fileName
            : null;
        
        return {
            id: url,
            width: +width,
            height: +heigth,
            url: url,
            kind: mapping[ art.keyType ],
            season: art.keyType == 'season' || art.keyType == 'seasonwide' ? +art.subKey : null,
            score: art.ratingsInfo.average || 0
        };
    }

    public createActorRoleRecord ( actor : any ) : RoleRecord {
        const url = stringNotEmpty( actor.image ) 
            ? this.baseImageUrl + actor.image 
            : null;

        return {
            art: {
                poster: url,
                thumbnail: null,
                background: null,
                banner: null
            },
            biography: null,
            birthday: null,
            deathday: null,
            internalId: actor.id,
            name: actor.name.trim(),
            naturalFrom: null,
            role: actor.role.trim(),
            order: actor.sortOrder
        };
    }
}