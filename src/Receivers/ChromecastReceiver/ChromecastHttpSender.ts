import { HttpSender } from "../BaseReceiver/HttpSender";
import { MediaStream, MediaStreamType } from "../../MediaProviders/MediaStreams/MediaStream";
import { SubtitlesMediaStream } from "../../MediaProviders/MediaStreams/SubtitlesStream";
import { SubtitlesConvertMediaStream } from "./MediaStreams/SubtitlesConvertMediaStream";

export class ChromecastHttpSender extends HttpSender {
    async getStream ( streams : MediaStream[], id : string, options : any = null ) : Promise<MediaStream> {
        const match = await super.getStream( streams, id, options );

        if ( match.type === MediaStreamType.Subtitles ) {
            const subtitles = match as SubtitlesMediaStream;
            
            if ( subtitles.format === 'srt' ) {
                const converted = new SubtitlesConvertMediaStream( subtitles );

                await converted.init();

                return converted;
            }
        }

        return match;
    }
}