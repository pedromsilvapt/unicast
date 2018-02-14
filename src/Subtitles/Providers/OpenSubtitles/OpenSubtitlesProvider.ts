import * as subtitler from 'subtitler';
import { ISubtitlesProvider, ISubtitle } from '../ISubtitlesProvider';
import { MediaKind, TvShowMediaRecord, CustomMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord } from '../../../MediaRecord';
import * as yauzl from 'yauzl';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import * as isSubtitle from 'is-subtitle';
import * as got from 'got';
import { UnicastServer } from '../../../UnicastServer';

export type MediaRecord = TvShowMediaRecord | TvEpisodeMediaRecord | TvSeasonMediaRecord | MovieMediaRecord | CustomMediaRecord;

export interface IOpenSubtitlesResult extends ISubtitle {
    id : string;
    download : {
        manual: string;
        zip: string;
        direct: string;
    };
}

export class OpenSubtitlesSubtitles implements ISubtitlesProvider<IOpenSubtitlesResult> {
    readonly name: string = 'opensubtitles';

    server : UnicastServer;

    protected token : any = null;
    protected tokenTimeout : NodeJS.Timer = null;

    protected api : any = subtitler.api;

    protected async getQueryForMedia ( media : MediaRecord, lang : string ) {
        if ( media.kind === MediaKind.Movie ) {
            if ( media.external.imdb ) {
                return { imdbid: media.external.imdb.slice( 2 ) };
            } else {
                return { query: media.title };
            }
        } else if ( media.kind == MediaKind.TvEpisode ) {
            const season = await this.server.media.get( MediaKind.TvSeason, media.tvSeasonId );

            const show = await this.server.media.get( MediaKind.TvShow, season.tvShowId );

            return {
                query: show.title,
                season: media.seasonNumber,
                episode: media.number
            };
        } else {
            return {
                query: media.title   
            };
        }
    }

    protected async getToken () {
        if ( this.tokenTimeout ) {
            clearTimeout( this.tokenTimeout )
        }

        this.token = await this.api.login();

        this.tokenTimeout = setTimeout( () => {
            this.token = null;
            this.tokenTimeout = null;
        }, 29 * 60 * 1000 );
    }

    async search ( media : MediaRecord, lang : string ) : Promise<IOpenSubtitlesResult[]> {
        if ( !this.token ) {
            await this.getToken();
        }

        const query = await this.getQueryForMedia( media, lang );

        console.log( query );
        
        let results : any[] = await this.api.search( this.token, lang, query );
        
        console.log( results.length );

        // {
        //     provider: 'openSubtitles',
        //     id: subtitles.IDSubtitleFile,
        //     idImdb: subtitles.IDMovieImdb,
        //     size: subtitles.SubSize,
        //     hash: subtitles.SubHash,
        //     lastTimestamp: subtitles.SubLastTS,
        //     format: subtitles.SubFormat,
        //     reports: +subtitles.SubBad,
        //     rating: subtitles.SubRating,
        //     addedAt: subtitles.SubAddDate,
        //     downloads: +subtitles.SubDownloadsCnt,
        //     releaseName: subtitles.MovieReleaseName || '',
        //     fps: subtitles.MovieFPS,
        //     idMovie: subtitles.IDMovie,
        //     idMovieImdb: subtitles.seriesIMDBParent || subtitles.IDMovieImdb,
        //     title: subtitles.MovieName,
        //     year: subtitles.MovieYear,
        //     imdbRating: subtitles.MovieImdbRating,
        //     language: subtitles.SubLanguageID,
        //     languageName: subtitles.LanguageName,
        //     languageISO639: subtitles.ISO639,
        //     encoding: subtitles.SubEncoding,
        //     type: subtitles.MovieKind,
        //     rank: this.getUserRankScore( subtitles.UserRank ),
        //     attributes: {
        //         hearingImpaired: !!( +subtitles.SubHearingImpaired ),
        //         highDefinition: !!( +subtitles.SubHD )
        //     },
        //     show: {
        //         season: +subtitles.SeriesSeason,
        //         episode: +subtitles.SeriesEpisode
        //     },
        //     download: {
        //         manual: subtitles.SubtitlesLink,
        //         zip: subtitles.ZipDownloadLink,
        //         direct: subtitles.SubDownloadLink
        //     }
        // };

        return results.map<IOpenSubtitlesResult>( result => ( {
            provider: this.name,
            id : result.IDSubtitleFile,
            releaseName: result.MovieReleaseName || '',
            encoding: result.SubEncoding,
            format: result.SubFormat,
            language: result.SubLanguageID,
            downloads: +result.SubDownloadsCnt,
            publishedAt: result.SubAddDate,
            download : {
                manual: result.SubtitlesLink,
                zip: result.ZipDownloadLink,
                direct: result.SubDownloadLink
            }
        } ) );
    }

    async download ( subtitle : IOpenSubtitlesResult ) : Promise<NodeJS.ReadableStream> {
        let url = subtitle.download.zip;

        let content = await got( url, {
            encoding: null
        } );

        console.log( subtitle.id );
        let result = new Promise<NodeJS.ReadableStream>( ( resolve, reject ) => {
            yauzl.fromBuffer( content.body, { lazyEntries: true }, ( err, file ) => {
                console.log( err );
                if ( err ) {
                    return reject( err );
                }

                file.readEntry();

                file.on( 'entry', entry => {
                    console.log( 'entry', entry.fileName );

                    if ( isSubtitle( entry.fileName ) ) {
                        file.openReadStream( entry, ( err, stream : NodeJS.ReadableStream ) => {
                            console.log( 'stream', stream );
                            
                            if ( err ) {
                                return reject( err );
                            }

                            stream = stream
                                .pipe( iconv.decodeStream( subtitle.encoding || 'CP1252' ) )
                                .pipe( iconv.encodeStream( 'utf8' ) );

                            resolve( stream );
                        } );

                        file.close();
                    } else {
                        file.readEntry();
                    }
                } );

                file.on( 'error', reject );
            } );
        } );

        return result;
    }
}