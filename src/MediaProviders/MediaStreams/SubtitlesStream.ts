import { MediaStream, MediaStreamType } from './MediaStream';
import { SubsPipeline, Pipeline, StreamReader, ParserPipeline, ContextManager, DecoderPipeline, LazyPipeline } from 'subbox';

export abstract class SubtitlesMediaStream extends MediaStream {
    static is ( stream : MediaStream ) : stream is SubtitlesMediaStream {
        return stream.type == MediaStreamType.Subtitles;
    }

    type : MediaStreamType = MediaStreamType.Subtitles;

    format : string;

    encoding : string = null;

    toJSON () {
        return {
            ...super.toJSON(),
            format: this.format
        };
    }

    pipeline () : SubsPipeline {
        return Pipeline.create(
            new LazyPipeline<void, NodeJS.ReadableStream, ContextManager>( () => this.open() ),
            new StreamReader( this.format ),
            new DecoderPipeline( this.encoding ),
            new ParserPipeline()
        );
    }
}