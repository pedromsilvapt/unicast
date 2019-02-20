import { BaseMediaProvider } from "../../../MediaProviders/BaseMediaProvider/BaseProvider";
import { ProvidersManager } from "../../../MediaProviders/ProvidersManager";
import { MediaSourceDetails } from "../../../MediaProviders/MediaSource";
import { FileSystemMediaSource } from "./FileSystemMediaSource";
import * as isVideo from 'is-video';
import * as isSubtitle from 'is-subtitle';

export class FileSystemMediaProvider extends BaseMediaProvider {
    readonly type : string = 'filesystem';

    WINDOWS_MATCH = /^[a-zA-Z]:(\\|\/)/;
    
    UNIX_MATCH = /^(\.|~)?\//;

    cacheKey () {
        return null;
    }

    match ( source : string ) : boolean {
        return ( this.WINDOWS_MATCH.test( source ) || this.UNIX_MATCH.test( source ) ) && ( isVideo( source ) || isSubtitle( source ) );
    }

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : FileSystemMediaSource {
        return new FileSystemMediaSource( manager, this, source );
    }
}