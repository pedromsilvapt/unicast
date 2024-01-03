import * as OS from 'opensubtitles.com';
import { ISubtitlesProvider, ISubtitle, SearchOptions } from '../../../Subtitles/Providers/ISubtitlesProvider';
import { MediaKind, TvShowMediaRecord, CustomMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, PlayableMediaRecord, isTvEpisodeRecord, isMovieRecord, MediaSources } from '../../../MediaRecord';
import * as yauzl from 'yauzl';
import * as iconv from 'iconv-lite';
import * as isSubtitle from 'is-subtitle';
import * as got from 'got';
import { UnicastServer } from '../../../UnicastServer';
import { Semaphore } from 'data-semaphore';

export type MediaRecord = TvShowMediaRecord | TvEpisodeMediaRecord | TvSeasonMediaRecord | MovieMediaRecord | CustomMediaRecord;

export interface IOpenSubtitlesResult extends ISubtitle {
    id : string;
    files: OS.SubtitleFile[];
}

export interface OpenSubtitlesConfig {
    enabled?: boolean;
    apiKey: string;
    username: string;
    password: string;
    cacheEnabled: boolean;
}

export class OpenSubtitlesProvider implements ISubtitlesProvider<IOpenSubtitlesResult> {
    readonly name: string = 'opensubtitles.com';

    server : UnicastServer;

    config : OpenSubtitlesConfig;

    protected token : string | null = null;

    protected tokenTimeout : NodeJS.Timer | null = null;

    protected tokenSemaphore : Semaphore = new Semaphore(1);

    protected api : OS;

    protected filesCache : Map<number, Promise<OS.DownloadResponse>>;

    public constructor( config : OpenSubtitlesConfig ) {
        this.config = {
            cacheEnabled: true,
            ...config
        };
        this.api = new OS({ apikey: config.apiKey });
    }

    protected async getQueryForMedia ( media : PlayableMediaRecord, searchOptions: SearchOptions ) : Promise<OS.SubtitlesOptions> {
        if ( isMovieRecord( media ) ) {
            if ( media.external.imdb ) {
                return { imdb_id: parseInt(media.external.imdb.slice( 2 ), 10) };
            } else {
                return { query: media.title, year: media.year };
            }
        } else if ( isTvEpisodeRecord( media ) ) {
            const season = await this.server.media.get( MediaKind.TvSeason, media.tvSeasonId );

            const show = await this.server.media.get( MediaKind.TvShow, season.tvShowId );

            return {
                parent_imdb_id: parseInt( show.external.imdb.slice( 2 ), 10 ),
                season_number: media.seasonNumber + ( searchOptions.seasonOffset ?? 0 ),
                episode_number: +media.number + ( searchOptions.episodeOffset ?? 0 )
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

        this.tokenTimeout = setTimeout( () => {
            this.token = null;
            this.tokenTimeout = null;
        }, 23 * 60 * 60 * 1000 );

        const response = await this.api.login({
            username: this.config.username,
            password: this.config.password,
        });

        this.token = response.token;
    }

    protected ensureToken() {
        return this.tokenSemaphore.use(() => {
            if ( !this.token ) {
                return this.getToken();
            } else {
                return Promise.resolve();
            }
        });
    }

    async search ( media : PlayableMediaRecord, options : SearchOptions ) : Promise<IOpenSubtitlesResult[]> {
        await this.ensureToken();

        try {
            const query = await this.getQueryForMedia( media, options );

            let results = await this.api.subtitles( query );

            const mediaSource = media.quality.source;

            return results.data.map<IOpenSubtitlesResult>( result => ( {
                provider: this.name,
                id : result.id,
                releaseName: result.attributes.release || '', // result.attributes.files[0].file_name || '',
                encoding: 'utf-8',
                format: 'srt',
                language: result.attributes.language,
                downloads: +result.attributes.download_count + result.attributes.new_download_count,
                publishedAt: new Date( result.attributes.upload_date ),
                files: result.attributes.files,
                score: MediaSources.similarity( MediaSources.normalize( MediaSources.findAny( result.attributes.release || '' ) ), mediaSource )
            } ) );
        } catch ( err ) {
            this.server.onError.notify( err );

            return [];
        }
    }

    async download ( subtitle : IOpenSubtitlesResult ) : Promise<NodeJS.ReadableStream> {
        await this.ensureToken;

        const fileId = subtitle.files[0].file_id;

        let download = this.filesCache.get( fileId );

        // If there is any cached links, check their reset time
        if ( download != null ) {
            const resetTime = new Date( ( await download ).reset_time_utc );

            const now = new Date();

            if ( resetTime < now ) {
                download = null;
            }
        }

        if ( download == null ) {
            download = this.api.download( { file_id: fileId } );

            if ( this.config.cacheEnabled ) {
                this.filesCache.set( fileId, download );
            }
        }

        let url = ( await download ).link;

        return got.stream( url, {
            encoding: null
        } );
    }
}
