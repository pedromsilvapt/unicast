import { MediaSource } from "../MediaSource";
import { MediaStream } from "../MediaStreams/MediaStream";
import { MediaRecord } from "../../MediaRecord";
import { KodiMediaProvider } from "./KodiMediaProvider";

export class KodiMediaSource extends MediaSource {
    provider : KodiMediaProvider;
    
    async scan () : Promise<MediaStream[]> {
        return [];
    }

    get sourceComponents () {
        const source = this.details.id;

        const [ protocol, segments ] = source.split( '://' );

        return [ protocol, ...segments.split( '/' ) ];
    }
    
    get sourceKind () {
        return this.sourceComponents[ 2 ];
    }

    get sourceId () {
        return this.sourceComponents[ 3 ];
    }

    info () : Promise<MediaRecord> {
        let [ kind, id ] = [ this.sourceKind, this.sourceId ];

        if ( kind === 'movie' ) {
            return this.provider.moviesRepository.fetch( id );
        } else if ( kind === 'episode' ) {
            return this.provider.tvEpisodesKodiRepository.fetch( id );
        }

        return Promise.resolve( null );
    }
}