import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import * as strToStream from 'string-to-stream';

export class HlsVirtualPlaylist {
    protected buffer : Buffer;

    driver : FFmpegHlsDriver;

    input : VideoMediaStream;

    get length () : number {
        if ( !this.buffer ) {
            return 0;
        }
        
        return this.buffer.length;
    }

    constructor ( driver : FFmpegHlsDriver, input : VideoMediaStream ) {
        this.driver = driver;
        this.input = input;

        this.buffer = this.create( driver, input );
    }

    protected create ( driver, input ) : Buffer {
        const lines : string[] = [];

        const duration : number = this.driver.getSegmentDuration();

        const dur = 1000 * this.driver.getSegmentDuration();        

        const durationString : string = '#EXTINF:' + Math.min( Math.ceil( dur / 23.98 ) * 23.98 / 1000, this.input.duration ) + ',';

        lines.push( 
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:' + ( duration + 1 ),
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-DISCONTINUITY'
        );

        let i = 0;

        for ( let s = 0; s < this.input.duration; i++ ) {
            lines.push( 
                s + duration > this.input.duration ? '#EXTINF:' + ( this.input.duration - s ) + ',' : durationString,
                ( this.driver.getSegmentLocationPrefix() || '' ) + 'index' + i + '.ts'
            );

            s += duration;
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