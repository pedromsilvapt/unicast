import { MediaStream, MediaStreamType } from "./MediaStream";

export abstract class VideoMediaStream extends MediaStream {
    type : MediaStreamType = MediaStreamType.Video;
    
    duration : number;

    // TODO Add a metadata object
    metadata : any;

    toJSON () {
        return {
            ...super.toJSON(),
            duration: this.duration
        };
    }
}