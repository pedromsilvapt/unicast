import { VideoMediaStream } from './VideoStream';
import { SubtitlesMediaStream } from './SubtitlesStream';
import { MediaStream, MediaStreamType } from './MediaStream';
import { Class } from '../../Tools/ToolsManager';

export class MediaStreamSelectors {
    static ofType<T extends MediaStream> ( streams : Iterable<MediaStream> | MediaStream[], type : Class<T> ): T[] {
        const streamsArray : MediaStream[] = streams instanceof Array
            ? streams
            : Array.from( streams );

        return streamsArray.filter( stream => stream instanceof type ) as T[];
    }

    static videos ( streams : Iterable<MediaStream> | MediaStream[] ) : VideoMediaStream[] {
        const streamsArray : MediaStream[] = streams instanceof Array
            ? streams
            : Array.from( streams );

        return streamsArray.filter( stream => VideoMediaStream.is( stream ) ) as VideoMediaStream[];
    }

    static firstVideo ( streams : Iterable<MediaStream> | MediaStream[] ) : VideoMediaStream {
        return MediaStreamSelectors.videos( streams )[ 0 ];
    }

    static subtitles ( streams : Iterable<MediaStream> | MediaStream[] ) : SubtitlesMediaStream[] {
        const streamsArray : MediaStream[] = streams instanceof Array
            ? streams
            : Array.from( streams );

        return streamsArray.filter( stream => SubtitlesMediaStream.is( stream ) ) as SubtitlesMediaStream[];
    }

    static firstSubtitles ( streams : Iterable<MediaStream> | MediaStream[] ) : SubtitlesMediaStream {
        return MediaStreamSelectors.subtitles( streams )[ 0 ];
    }
}
