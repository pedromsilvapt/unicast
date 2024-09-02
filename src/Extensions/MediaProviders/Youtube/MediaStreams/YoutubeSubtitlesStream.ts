import { SubtitlesMediaStream } from "../../../../MediaProviders/MediaStreams/SubtitlesStream";
import { YoutubeMediaSource } from "../YoutubeMediaSource";
import { MediaRange } from "../../../../MediaProviders/MediaStreams/MediaStream";
import * as mime from 'mime';
import { YoutubeSubtitleResult } from "../SubtitlesDownloader";
import * as got from 'got';
import * as rangeStream from 'range-stream';
import { remoteFileSize } from "../../../../ES2017/RemoteFileSize";
import * as stringToStream from 'string-to-stream';
import * as streamToString from 'stream-to-string';

export class YoutubeSubtitlesMediaStream extends SubtitlesMediaStream {
    file : string;

    source : YoutubeMediaSource;

    options : YoutubeSubtitleResult;

    contentCache ?: string = null;

    constructor ( file : string, source : YoutubeMediaSource, options : YoutubeSubtitleResult ) {
        super( file, source );

        this.file = file;

        this.options = options;
    }

    async init () : Promise<void> {
        this.size = await remoteFileSize( this.options.url );
        this.mime = mime.getType( this.options.format );
        this.format = this.options.format;

        // Size should not be bigger than 1MB
        // If it is, then no cache should be made
        if ( this.size && this.size < 1024 * 1024 ) {
            const contentCacheReader = got.stream( this.options.url );

            this.contentCache = await streamToString( contentCacheReader );

            this.size = Buffer.from( this.contentCache ).length;
        }
    }

    open ( range : MediaRange = {} ) : NodeJS.ReadableStream {
        const options : any = {};
        
        if ( typeof range.start === 'number' ) {
            options.start = range.start;
        }

        if ( typeof range.end === 'number' ) {
            options.end = range.end;
        }

        const reader = this.contentCache ? stringToStream( this.contentCache ) : got.stream( this.options.url );

        if ( options.start || options.end ) {
            return reader.pipe( rangeStream( options.start || 0, options.end || void 0 ) );
        }

        return reader;
    }
}
