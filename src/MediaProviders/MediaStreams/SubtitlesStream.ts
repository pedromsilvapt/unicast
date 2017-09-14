import { MediaStream, MediaStreamType } from './MediaStream';

export abstract class SubtitlesMediaStream extends MediaStream {
    type : MediaStreamType = MediaStreamType.Subtitles;

    format : string;

    toJSON () {
        return {
            ...super.toJSON(),
            format: this.format
        };
    }
}