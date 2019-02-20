import { SubtitlesMediaStream } from "../../../../MediaProviders/MediaStreams/SubtitlesStream";
import { MediaRange } from "../../../../MediaProviders/MediaStreams/MediaStream";
import { SubboxPipeline, SubsMessageProtocol, CompilerPipeline, EncoderPipeline, StreamDuplex, StdContext, SubsPipeline } from "subbox";
import * as rangeStream from 'range-stream';
import * as pump from 'pump';

export type SubtitlesStreamPipeline = SubboxPipeline<AsyncIterable<SubsMessageProtocol>, AsyncIterableIterator<SubsMessageProtocol>>;

const streamLength = ( stream : NodeJS.ReadableStream ) : Promise<number> => {
    return new Promise<number>( ( resolve, reject ) => {
        let sum : number = 0;

        stream.on( 'data', chunk => {
            sum += chunk.length;
        } ).on( 'end', () => resolve( sum ) ).on( 'error', reject );
    } );
};

export class SubtitlesPipelineMediaStream extends SubtitlesMediaStream {
    seekable : boolean = false;

    original : SubtitlesMediaStream;

    transform ?: SubtitlesStreamPipeline;

    constructor ( original : SubtitlesMediaStream, transform ?: SubtitlesStreamPipeline ) {
        super( original.id, original.source );

        this.original = original;
        this.transform = transform;
    }

    async init () : Promise<void> {
        await this.original.init();
    }

    pipeline () : SubsPipeline {
        const basePipeline = this.original.pipeline();

        if ( !this.transform ) {
            return basePipeline;
        }

        return basePipeline.pipe( this.transform );
    }

    open ( range ?: MediaRange ) : NodeJS.ReadableStream {
        const fullStream = this.pipeline()
            .pipe( new CompilerPipeline( this.format ) )
            .pipe( new EncoderPipeline( this.encoding || 'utf8' ) )
            .pipe( new StreamDuplex() )
            .run( new StdContext() );

        if ( !range || ( typeof range.start != 'number' && typeof range.end != 'number' ) ) {
            return fullStream;
        }

        return pump( fullStream, rangeStream( range.start, range.end ) );
    }
}