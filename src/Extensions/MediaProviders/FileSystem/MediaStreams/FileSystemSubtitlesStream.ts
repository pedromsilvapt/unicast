import { SubtitlesMediaStream } from '../../../../MediaProviders/MediaStreams/SubtitlesStream';
import { FileSystemMediaSource } from "../FileSystemMediaSource";
import { MediaRange } from "../../../../MediaProviders/MediaStreams/MediaStream";
import * as mime from 'mime';
import * as fs from 'mz/fs';
import * as path from 'path';

export class FileSystemSubtitlesMediaStream extends SubtitlesMediaStream {
    metadata : any;

    file : string;

    get name () : string {
        return path.basename( this.file, path.extname( this.file ) );
    }

    get extension () : string {
        return path.extname( this.file ).slice( 1 ) || null;
    }

    constructor ( file : string, source : FileSystemMediaSource, metadata : any = null ) {
        super( file, source );

        this.metadata = metadata;

        this.file = file;
    }

    get filename () : string {
        return path.basename( this.file );
    }

    async init () : Promise<void> {
        const file = this.file;

        this.size = ( await fs.stat( file ) ).size;
        this.mime = mime.getType( file );
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
