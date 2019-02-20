import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import * as strToStream from 'string-to-stream';
import { FFmpegHlsTranscodingTask } from './FFmpegHlsTranscodingTask';

export class HlsVirtualPlaylist {
    protected buffer : Buffer;

    task : FFmpegHlsTranscodingTask;

    get length () : number {
        if ( !this.buffer ) {
            return 0;
        }
        
        return this.buffer.length;
    }

    constructor ( task : FFmpegHlsTranscodingTask ) {
        this.task = task;

        this.buffer = this.create();
    }

    protected create () : Buffer {
        const lines : string[] = [];

        const round = ( n : any, d : any ) => Math.round( n * d ) / d;
        
        const decimals = 100000;
        
        const duration = round( this.task.getSegmentDuration(), decimals );
        const lastDuration = round( duration * ( this.task.input.duration % duration ), decimals );

        const initDurationString = '#EXTINF:' + duration + ',';
        const lastDurationString = '#EXTINF:' + lastDuration + ',';

        const totalSegments = Math.ceil( this.task.input.duration / duration );

        lines.push( 
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:' + ( Math.floor( duration ) + 1 ),
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-DISCONTINUITY'
        );

        let i = 0;

        for ( let i = 0; i < totalSegments; i++ ) {
            lines.push( 
                i == totalSegments - 1 && lastDuration > 0 ? lastDurationString : initDurationString,
                ( this.task.driver.getSegmentLocationPrefix() || '' ) + 'index' + i + '.ts'
            );
        }

        lines.push( '#EXT-X-ENDLIST' );

        return Buffer.from( lines.join( '\n' ) );
    }

    toBuffer () : Buffer {
        return this.buffer;
    }

    toString () : string {
        return this.buffer.toString( 'utf8' );
    }

    toStream () : NodeJS.ReadableStream {
        return strToStream( this.toString() );
    }
}