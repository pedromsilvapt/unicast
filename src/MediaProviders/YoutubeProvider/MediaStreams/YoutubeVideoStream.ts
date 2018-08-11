import { VideoMediaStream } from "../../MediaStreams/VideoStream";
import { MediaRange } from "../../MediaStreams/MediaStream";
import { YoutubeMediaSource } from "../YoutubeMediaSource";
import * as ytdl from 'ytdl-core';
import { remoteFileSize } from "../../../ES2017/RemoteFileSize";

export class YoutubeVideoMediaStream extends VideoMediaStream {
    url : string;

    source : YoutubeMediaSource;

    constructor ( url : string, source : YoutubeMediaSource ) {
        super( url, source );

        this.url = url;
    }

    async init ? () : Promise<void> {
        this.size = await remoteFileSize( this.url );
        this.mime = this.source.format.type;
        this.duration = +this.source.videoInfo.length_seconds;
    }

    getInputForDriver<I = any> ( driver : string ) : I {
        if ( driver === 'ffmpeg' || driver === 'ffmpeg-hls' ) {
            // getUrlFor
            return this.url as any;
        }

        return null;
    }

    open ( range : MediaRange = {} ) : NodeJS.ReadableStream {
        const options : any = {};
        
        if ( typeof range.start === 'number' ) {
            options.start = range.start;
        }

        if ( typeof range.end === 'number' ) {
            options.end = range.end;
        }

        return ytdl.downloadFromInfo( this.source.videoInfo, {
            format: this.source.format,
            range: options
        } );
    }
}
