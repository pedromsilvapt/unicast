import { ISubtitlesProvider, ISubtitle, SearchOptions } from '../ISubtitlesProvider';
import { MediaKind, TvShowMediaRecord, CustomMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, PlayableMediaRecord, isTvEpisodeRecord, isMovieRecord, MediaSources } from '../../../MediaRecord';
import * as iconv from 'iconv-lite';
import { UnicastServer } from '../../../UnicastServer';
import { Readable } from 'stream';

export type MediaRecord = TvShowMediaRecord | TvEpisodeMediaRecord | TvSeasonMediaRecord | MovieMediaRecord | CustomMediaRecord;

export interface IUploadedSubtitleResult extends ISubtitle {
    fileName : string;
    contents : string;
}

export class UploadedSubtitlesProvider implements ISubtitlesProvider<IUploadedSubtitleResult> {
    readonly name: string = 'uploadedsubtitles';

    readonly disableCaching : boolean = true;

    server : UnicastServer;

    async search ( media : PlayableMediaRecord, options : SearchOptions ) : Promise<IUploadedSubtitleResult[]> {
        return Promise.resolve( [] );
    }

    async download ( subtitle : IUploadedSubtitleResult ) : Promise<NodeJS.ReadableStream> {
        var buffer = Buffer.from( subtitle.contents, 'base64' );

        const readable = new Readable();
        readable._read = () => {}; // _read is required but you can noop it
        readable.push( buffer );
        readable.push( null );

        if ( subtitle.encoding != null && subtitle.encoding.toLowerCase() !== 'utf8' ) {
            const encodedReadable = readable
                .pipe( iconv.decodeStream( subtitle.encoding || 'CP1252' ) )
                .pipe( iconv.encodeStream( 'utf8' ) );

            return Promise.resolve( encodedReadable );
        }

        return Promise.resolve( readable );
    }
}
