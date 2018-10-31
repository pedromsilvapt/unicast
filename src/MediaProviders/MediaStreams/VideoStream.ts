import { MediaStream, MediaStreamType } from "./MediaStream";
import { MediaMetadata } from "../../MediaTools";

export abstract class VideoMediaStream extends MediaStream {
    static is ( stream : MediaStream ) : stream is VideoMediaStream {
        return stream.type == MediaStreamType.Video;
    }


    type : MediaStreamType = MediaStreamType.Video;
    
    duration : number;

    metadata : MediaMetadata;

    toJSON () {
        return {
            ...super.toJSON(),
            duration: this.duration
        };
    }
}