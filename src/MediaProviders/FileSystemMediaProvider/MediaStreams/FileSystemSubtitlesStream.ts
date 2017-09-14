import { SubtitlesMediaStream } from "../../MediaStreams/SubtitlesStream";
import { FileSystemMediaSource } from "../FileSystemMediaSource";
import { ProvidersManager } from "../../ProvidersManager";
import { MediaRange } from "../../MediaStreams/MediaStream";
import * as fs from 'mz/fs';
import * as mime from 'mime';
import * as path from 'path';

export class FileSystemSubtitlesMediaStream extends SubtitlesMediaStream {
    metadata : any;

    file : string;

    constructor ( file : string, source : FileSystemMediaSource, metadata : any = null ) {
        super( file, source );

        this.metadata = metadata;

        this.file = file;
    }

    async init () : Promise<void> {
        const file = this.file;
        
        this.size = ( await fs.stat( file ) ).size;
        this.mime = mime.lookup( file );
        this.format = path.extname( file ).slice( 1 ).toLowerCase() || null;
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
