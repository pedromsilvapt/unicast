import { HttpSender } from '../../../Receivers/BaseReceiver/HttpSender';
import { MediaStream, MediaStreamType } from '../../../MediaProviders/MediaStreams/MediaStream';
import { SubtitlesMediaStream } from "../../../MediaProviders/MediaStreams/SubtitlesStream";
import { SubtitlesPipelineMediaStream, SubtitlesStreamPipeline } from "./MediaStreams/SubtitlesPipelineMediaStream";
import { Pipeline, FilterEmptyLinesPipeline, FilterPipeline, EditFormattingPipeline, OffsetPipeline } from "subbox";
import { ChromecastReceiver } from "./ChromecastReceiver";

export class ChromecastHttpSender extends HttpSender {
    receiver : ChromecastReceiver;

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
            pipeline = pipeline.pipe( filter );
        }

        if ( typeof offset === 'number' && offset != 0 ) {
            pipeline = pipeline.pipe( new OffsetPipeline( offset ) );
        }

        return pipeline;
    }

    async getStream ( streams : MediaStream[], id : string, options : any = null ) : Promise<MediaStream> {
        const match = await super.getStream( streams, id, options );

        if ( match.type === MediaStreamType.Subtitles ) {
            const subtitles = match as SubtitlesMediaStream;
            
            if ( subtitles.format === 'srt' ) {
                // TODO Remove this line and SubtitlesConvertMediaStream
                // const converted = new SubtitlesConvertMediaStream( subtitles );

                const converted = new SubtitlesPipelineMediaStream( subtitles, this.getSubtitlesPipeline( +options.offset ) );

                converted.format = 'vtt';

                converted.mime = 'text/vtt';

                await converted.init();

                return converted;
            }
        }

        return match;
    }
}