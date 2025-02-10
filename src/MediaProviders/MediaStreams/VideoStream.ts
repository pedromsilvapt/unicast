import { MediaStream, MediaStreamType } from "./MediaStream";
import { MediaProbe } from "../../MediaTools";

export abstract class VideoMediaStream extends MediaStream {
    static is ( stream : MediaStream ) : stream is VideoMediaStream {
        return stream.type == MediaStreamType.Video;
    }

    type : MediaStreamType = MediaStreamType.Video;

    duration : number;

    metadata : MediaProbe;

    toJSON () {
        return {
            ...super.toJSON(),
            duration: this.duration
        };
    }
}
