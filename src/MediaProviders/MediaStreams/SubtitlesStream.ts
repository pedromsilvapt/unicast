import { MediaStream, MediaStreamType } from './MediaStream';
import { SubsPipeline, Pipeline, StreamReader, ParserPipeline, ContextManager, DecoderPipeline, LazyPipeline } from 'subbox';
import { detect } from 'jschardet';

export abstract class SubtitlesMediaStream extends MediaStream {
    static is ( stream : MediaStream ) : stream is SubtitlesMediaStream {
        return stream.type == MediaStreamType.Subtitles;
    }

    type : MediaStreamType = MediaStreamType.Subtitles;

    format : string;

    encoding : string = null;

    async autoDetectEncoding () {
        const reader = this.reader();

        const content = await new Promise<Buffer>((resolve, reject) => {
            const buffers: Buffer[] = [];
            reader.on('data', bf => buffers.push(bf));
            reader.on('end', () => resolve(Buffer.concat(buffers)));
            reader.on('error', err => reject(err));
        });

        this.encoding = detect( content ).encoding;
    }

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
