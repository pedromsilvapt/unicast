import * as subtitler from 'subtitler';
import { ISubtitlesProvider, ISubtitle } from '../ISubtitlesProvider';
import { MediaKind, TvShowMediaRecord, CustomMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, PlayableMediaRecord, isTvEpisodeRecord, isMovieRecord, MediaSources } from '../../../MediaRecord';
import * as yauzl from 'yauzl';
import * as iconv from 'iconv-lite';
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

export class OpenSubtitlesProvider implements ISubtitlesProvider<IOpenSubtitlesResult> {
    readonly name: string = 'opensubtitles';

    server : UnicastServer;

    protected token : any = null;

    protected tokenTimeout : NodeJS.Timer = null;

    protected api : any = subtitler.api;

    protected async getQueryForMedia ( media : PlayableMediaRecord, lang : string ) {
        if ( isMovieRecord( media ) ) {
            if ( media.external.imdb ) {
                return { imdbid: media.external.imdb.slice( 2 ) };
            } else {
                return { query: media.title };
            }
        } else if ( isTvEpisodeRecord( media ) ) {
            const season = await this.server.media.get( MediaKind.TvSeason, media.tvSeasonId );

            const show = await this.server.media.get( MediaKind.TvShow, season.tvShowId );

            return {
                imdbid: show.external.imdb.slice( 2 ),
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

    async search ( media : PlayableMediaRecord, lang : string ) : Promise<IOpenSubtitlesResult[]> {
        if ( !this.token ) {
            await this.getToken();
        }

        try {
            const query = await this.getQueryForMedia( media, lang );
            
            let results : any[] = await this.api.search( this.token, lang, query );
    
            const mediaSource = media.quality.source;

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
                },
                score: MediaSources.similarity( MediaSources.normalize( MediaSources.findAny( result.MovieReleaseName ) ), mediaSource )
            } ) );
        } catch ( err ) {
            this.server.onError.notify( err );

            return [];
        }
    }

    async download ( subtitle : IOpenSubtitlesResult ) : Promise<NodeJS.ReadableStream> {
        let url = subtitle.download.zip;

        let content = await got( url, {
            encoding: null
        } );

        if ( content.body.length < 1000 && content.body.toString( 'utf8' ).startsWith( 'Incorrect download parameters detected;' ) ) {
            throw new Error( content.body.toString( 'utf8' ) );
        }

        let result = new Promise<NodeJS.ReadableStream>( ( resolve, reject ) => {
            yauzl.fromBuffer( content.body, { lazyEntries: true }, ( err, file ) => {
                try {
                    if ( err ) {
                        return reject( err );
                    }

                    if ( file.entryCount > 100 ) {
                        return reject( new Error( `Too many files in the zip "${ file.entryCount }".` ) );
                    }
    
                    let foundSubs : boolean = false;
                    
                    file.readEntry();
    
                    file.on( 'entry', entry => {
                        if ( isSubtitle( entry.fileName ) ) {
                            file.openReadStream( entry, ( err, stream : NodeJS.ReadableStream ) => {
                                if ( err ) {
                                    return reject( err );
                                }
    
                                try {
                                    foundSubs = true;
        
                                    stream = stream
                                        .pipe( iconv.decodeStream( subtitle.encoding || 'CP1252' ) )
                                        .pipe( iconv.encodeStream( 'utf8' ) );
        
                                    resolve( stream );
                                } catch ( error ) {
                                    reject( error );
                                }
                            } );
    
                            file.close();
                        } else {
                            file.readEntry();
                        }
                    } );
    
                    file.on( 'end', () => {
                        if ( !foundSubs ) {
                            reject( new Error( `Could not find subtitles.` ) );
                        }
                    } );
    
                    file.on( 'error', reject );
                } catch ( error ) {
                    reject( error );
                }
            } );
        } );

        return result;
    }
}