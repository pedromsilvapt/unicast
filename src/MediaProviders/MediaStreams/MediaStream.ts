import * as rangeStream from 'range-stream';
import * as pump from 'pump';
import * as sha1 from 'sha1';
import { MediaSource } from "../MediaSource";

export enum MediaStreamType {
    Video = 'video',
    Subtitles = 'subtitles'
}

export interface MediaRange {
    start ?: number;
    end ?: number;
}

export abstract class MediaStream {
    id : string;

    size : number;

    mime : string;

    seekable : boolean = true;

    type : MediaStreamType;

    source : MediaSource;

    enabled : boolean = true;

    isContainer : boolean = false;

    constructor ( id : string, source : MediaSource ) {
        this.id = id ? sha1( id ) as string : null;
        this.source = source;
    }

    getInputForDriver<I = any> ( driver : string ) : I {
        return null;
    }

    abstract init ? () : Promise<void>;

    abstract open ( range ?: MediaRange ) : NodeJS.ReadableStream;

    protected async resolveInnerStream ( options : any ) : Promise<MediaStream> {
        return null;
    }

    async getInnerStream ( options : any ) : Promise<MediaStream> {
        const stream = await this.resolveInnerStream( options );

        if ( stream ) {
            await stream.init();
    
            if ( stream.isContainer ) {
                return ( await stream.getInnerStream( options ) ) || stream;
            }
    
            return stream;
        }

        return null;
    }

    reader ( range ?: MediaRange, options ?: any ) : NodeJS.ReadableStream {
        const input = this.open( range || {} );
        
        if ( this.seekable || !range || ( !range.start && !range.end ) ) {
            return input;
        }

        return pump( input, rangeStream( range.start, range.end ) );
    }

    close ( stream ?: NodeJS.ReadableStream ) {
        // TODO Do nothing for now
    }

    toJSON () {
        const id = this.id;
        const type = this.type;
        const mime = this.mime;
        const size = this.size;
        const provider = this.source.provider.type;
        
        return { id, provider, type, mime, size };
    }
}
