import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { MediaRange } from "../../MediaProviders/MediaStreams/MediaStream";
import { Storage } from "../../Storage";
import { FFmpegHlsTranscodingTask } from "./FFmpegHlsTranscodingTask";
import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import * as fs from 'mz/fs';
import * as path from 'path';
import * as mime from 'mime';
import { HistoryRecord } from "../../Database";
import { HlsVirtualPlaylist } from "./HlsVirtualPlaylist";

export function delay<T = void> ( time, value : T = null ) : Promise<T> {
    return new Promise<T>( resolve => setTimeout( resolve.bind( null, value ), time ) );
}

export class HlsVideoMediaStream extends VideoMediaStream {
    session : HistoryRecord;
    
    inputStream : VideoMediaStream;

    storage : Storage;

    driver : FFmpegHlsDriver;

    task : FFmpegHlsTranscodingTask;

    folder : string;

    readonly isContainer : boolean = true;

    seekable : boolean = false;

    size : number = null;

    mime : string = 'application/x-mpegurl';

    get file () : string {
        return path.join( this.folder, 'index.m3u8' );
    }

    constructor ( session : HistoryRecord, driver : FFmpegHlsDriver, inputStream : VideoMediaStream, storage : Storage ) {
        super( inputStream.id + '-hls', inputStream.source );

        this.session = session;

        this.driver = driver;

        this.inputStream = inputStream;

        this.storage = storage;
    }

    async init () : Promise<void> {
        this.folder = await this.storage.getRandomFolder( 'ffmpeg-hls' );

        const url = await this.storage.server.getUrl( `/media/send/chromecast/${ this.session.receiver }/session/${ this.session.id }/stream/${ this.id }?part=` );

        this.driver.setSegmentLocationPrefix( url );

        this.task = new FFmpegHlsTranscodingTask( this.inputStream, this.driver, this.folder );

        this.task.start();
    }

    virtual : HlsVirtualPlaylist;

    async refresh () {
        await this.task.segments.waitFor( 2 );
        
        if ( !this.virtual ) {
            this.virtual = new HlsVirtualPlaylist( this.driver, this.inputStream );
        }

        this.size = this.virtual.toBuffer().length;
    }

    async resolveInnerStream ( options : any ) {
        if ( options && options.part ) {
            return new HlsSegmentVideoMediaStream( this, options.part );
        }

        await this.refresh();
    }

    close ( stream ?: NodeJS.ReadableStream ) {
        if ( !stream ) {
            this.inputStream.close();
            
            this.task.cancel();
        }
    }

    open ( range ?: MediaRange ) : NodeJS.ReadableStream {
        return this.virtual.toStream();
    }
}

export class HlsSegmentVideoMediaStream extends VideoMediaStream {
    index : HlsVideoMediaStream;

    part : string;

    get file () : string {
        return path.join( this.index.folder, this.index.task.segments.get( this.number ).id, this.part )
    }

    get number () : number {
        const basename = path.basename( this.part, path.extname( this.part ) );

        return +basename.slice( 'index'.length );
    }

    constructor ( index : HlsVideoMediaStream, part : string ) {
        super( index.id + part, index.source );

        this.index = index;

        this.part = part;
    }

    async init () : Promise<void> { 
        if ( !this.index.task.segments.has( this.number + 3 ) || !this.index.task.segments.has( this.number + 3 ) ) {
            this.index.task.scheduler.request( this.number );
            
            await this.index.task.segments.waitFor( this.number + 3 );
            await this.index.task.segments.waitFor( this.number );
        }

        while ( !this.size ) {
            this.size = +( await fs.stat( this.file ) ).size;
        }

        this.mime = mime.lookup( this.file );
    }

    open ( range ?: MediaRange ) : NodeJS.ReadableStream {
        return fs.createReadStream( this.file, range );
    }
    
    toJSON () {
        return {
            ...super.toJSON(),
            part: this.part
        }
    }
}