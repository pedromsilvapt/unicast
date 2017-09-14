import { VideoMediaStream } from "../../MediaStreams/VideoStream";
import { FileSystemMediaSource } from "../FileSystemMediaSource";
import { ProvidersManager } from "../../ProvidersManager";
import { MediaRange } from "../../MediaStreams/MediaStream";
import * as fs from 'mz/fs';
import * as mime from 'mime';
import { MediaTools } from "../../../MediaTools";

export class FileSystemVideoMediaStream extends VideoMediaStream {
    metadata : any;

    file : string;

    constructor ( file : string, source : FileSystemMediaSource, metadata : any = null ) {
        super( file, source );

        this.metadata = metadata;

        this.file = file;
    }

    async init ? () : Promise<void> {
        const file = this.file;
        
        this.metadata = this.metadata || await MediaTools.probe( file );
        this.size = +( await fs.stat( file ) ).size;
        this.mime = mime.lookup( file );
        this.duration = +this.metadata.files[ 0 ].duration;
    }

    open ( range : MediaRange = {} ) : NodeJS.ReadableStream {
        const options : any = {};
        
        if ( typeof range.start === 'number' ) {
            options.start = range.start;
        }

        if ( typeof range.end === 'number' ) {
            options.end = range.end;
        }

        return fs.createReadStream( this.file, options );
    }
}
