import { BaseMediaProvider } from "../../../MediaProviders/BaseMediaProvider/BaseProvider";
import { ProvidersManager } from "../../../MediaProviders/ProvidersManager";
import { MediaSourceDetails } from "../../../MediaProviders/MediaSource";
import { YoutubeMediaSource } from "./YoutubeMediaSource";

export class YoutubeMediaProvider extends BaseMediaProvider {
    readonly type : string = 'youtube';

    YOUTUBE_MATCH = /youtu.*(?:(?:\.be|v|embed)\/|watch\?.*v=)([^#&?]*).*/i;

    cacheKey () {
        return null;
    }

    match ( source : string ) : boolean {
        return this.YOUTUBE_MATCH.test( source );
    }

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : YoutubeMediaSource {
        return new YoutubeMediaSource( manager, this.server.mediaTools, this, source );
    }
}
