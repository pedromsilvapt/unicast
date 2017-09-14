import { SubtitlesMediaStream } from "../../../MediaProviders/MediaStreams/SubtitlesStream";
import * as srt2vtt from 'srt-to-vtt';

const streamLength = ( stream : NodeJS.ReadableStream ) : Promise<number> => {
    return new Promise<number>( ( resolve, reject ) => {
        let sum : number = 0;

        stream.on( 'data', chunk => {
            sum += chunk.length;
        } ).on( 'end', () => resolve( sum ) ).on( 'error', reject );
    } );
};

export class SubtitlesConvertMediaStream extends SubtitlesMediaStream {
    seekable : boolean = false;

    stream : SubtitlesMediaStream;
    
    format : string = 'vtt';
    
    mime : string = 'text/vtt';

    constructor ( stream : SubtitlesMediaStream ) {
        super( stream.id, stream.source );

        this.id = stream.id;

        this.stream = stream;
    }

    async init () {
        this.size = await streamLength( this.open() );
    }

    open () {
        return this.stream.open().pipe( srt2vtt() );
    }
}