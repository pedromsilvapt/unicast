import { HttpSender } from '../../../Receivers/BaseReceiver/HttpSender';
import { MediaStream, MediaStreamType } from '../../../MediaProviders/MediaStreams/MediaStream';
import { SubtitlesMediaStream, replaceExtension } from "../../../MediaProviders/MediaStreams/SubtitlesStream";
import { SubtitlesPipelineMediaStream, SubtitlesStreamPipeline } from "../Chromecast/MediaStreams/SubtitlesPipelineMediaStream";
import { Pipeline, FilterEmptyLinesPipeline, FilterPipeline, EditFormattingPipeline, OffsetPipeline } from "subbox";
import { KodiReceiver } from './KodiReceiver';

export class KodiHttpSender extends HttpSender {
    receiver : KodiReceiver;

    getFilterPipeline () : FilterPipeline {
        const subtitles = this.receiver.config.subtitles;

        if ( !subtitles ) {
            return null;
        }

        const config = subtitles.lineFilters;

        if ( config ) {
            return new FilterPipeline( config, true );
        }

        return null;
    }

    getSubtitlesPipeline ( offset : number = null ) : SubtitlesStreamPipeline {
        const filter = this.getFilterPipeline();

        let pipeline = Pipeline.create(
            new EditFormattingPipeline(),
            new FilterEmptyLinesPipeline(),
        );

        if ( filter ) {
            pipeline = pipeline.pipe( filter as any );
        }

        if ( typeof offset === 'number' && offset != 0 && !isNaN( offset ) ) {
            pipeline = pipeline.pipe( new OffsetPipeline( offset ) as any );
        }

        return pipeline as any;
    }

    getFilenameFor ( stream : MediaStream ) : string {
        // SRT subtitles are converted to VTT when served (see `getStream`)
        if ( SubtitlesMediaStream.is( stream ) && stream.format === 'srt' ) {
            return replaceExtension( stream.filename, 'vtt' );
        }

        return super.getFilenameFor( stream );
    }

    async getStream ( streams : MediaStream[], id : string, options : any = null ) : Promise<MediaStream> {
        const match = await super.getStream( streams, id, options );

        if ( match.type === MediaStreamType.Subtitles ) {
            const subtitles = match as SubtitlesMediaStream;

            if ( subtitles.format === 'srt' ) {
                const converted = new SubtitlesPipelineMediaStream( subtitles, this.getSubtitlesPipeline( +options.offset ) );

                converted.format = 'vtt';

                converted.mime = 'text/vtt';

                await converted.init( this.receiver.server.mediaTools );

                return converted;
            }
        }

        return match;
    }
}
