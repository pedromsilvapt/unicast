import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { MediaRange, MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { Storage } from "../../Storage";
import { FFmpegHlsTranscodingTask } from "./FFmpegHlsTranscodingTask";
import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import * as fs from 'mz/fs';
import * as path from 'path';
import * as mime from 'mime';
import { HistoryRecord } from "../../Database/Database";
import { HlsVirtualPlaylist } from "./HlsVirtualPlaylist";
import { Readable } from "stream";
import { TranscodedMediaStream } from "../Transcoder";

export function delay<T = void> ( time, value : T = null ) : Promise<T> {
    return new Promise<T>( resolve => setTimeout( resolve.bind( null, value ), time ) );
}

export class HlsVideoMediaStream extends VideoMediaStream implements TranscodedMediaStream {
    static is ( stream : MediaStream ) : stream is HlsVideoMediaStream {
        return stream instanceof HlsVideoMediaStream;
    }

    readonly isTranscoded = true;

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

        // TODO This driver can be used for receivers other than chromecast
        const url = this.storage.server.getUrl( `/media/send/chromecast/${ this.session.receiver }/session/${ this.session.id }/stream/${ this.id }?part=` );

        this.driver.setSegmentLocationPrefix( url );

        const record = await this.storage.server.media.get( this.session.mediaKind, this.session.mediaId );

        this.task = new FFmpegHlsTranscodingTask( record, this.inputStream, this.driver, this.folder );

        this.task.setStateStart();
    }

    virtual : HlsVirtualPlaylist;

    async refresh () {
        await this.task.segments.waitFor( 2 );
        
        if ( !this.virtual ) {
            this.virtual = new HlsVirtualPlaylist( this.task );

            await fs.writeFile( path.join( this.folder, 'index.m3u8' ), this.virtual.toBuffer() );
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
            
            this.task.setStateCancel();
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
            
            await this.index.task.segments.waitFor( Math.min( this.number + 3, this.index.task.segments.totalCount - 1 ) );
            await this.index.task.segments.waitFor( this.number );
        }

        while ( !this.size ) {
            this.size = +( await fs.stat( this.file ) ).size;
        }

        this.mime = mime.getType( this.file );
    }

    async openAsync ( range : MediaRange, readable : Readable ) : Promise<void> {
        let tries = 0;
        const maxTries = 10;

        while ( true ) {
            try {
                let buffer = await fs.readFile( this.file );

                if ( range ) {
                    buffer = buffer.slice( range.start || 0, range.end );
                }

                readable.push( buffer );
                readable.push( null );

                break;
            } catch ( error ) {
                console.error( new Error( `Retry ${ tries } error ${ error.message }` ).message );

                tries++;

                if ( tries >= maxTries ) {
                    readable.destroy( error );

                    break;
                }

                // TODO Check import
                await delay( 2000, void 0 );
            }
        }
    }

    open ( range ?: MediaRange ) : NodeJS.ReadableStream {
        const stream = new Readable( { 
            read () {
                return null;
            } 
        } );

        this.openAsync( range, stream )
            .catch( err => stream.destroy( err ) );

        return stream;
        // console.log( 'open', this.index.task.segments.get( this.number ).id, this.number, this.index.task.getSegmentTime( this.number ), range );
        // const options : any = {};
        
        // if ( typeof range.start === 'number' ) {
        //     options.start = range.start;
        // }

        // if ( typeof range.end === 'number' ) {
        //     options.end = range.end;
        // }

        // return new ResilientReadStream( ( start, end ) => fs.createReadStream( this.file, { start, end } ), options );

        // return fs.createReadStream( this.file, range );
    }
    
    toJSON () {
        return {
            ...super.toJSON(),
            part: this.part
        }
    }
}
