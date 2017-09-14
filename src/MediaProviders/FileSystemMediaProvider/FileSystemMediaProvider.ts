import { BaseMediaProvider } from "../BaseMediaProvider/BaseProvider";
import { IMediaRepository } from "../../MediaRepositories/BaseRepository/IMediaRepository";
import { ProvidersManager } from "../ProvidersManager";
import { MediaSourceDetails } from "../MediaSource";
import { FileSystemMediaSource } from "./FileSystemMediaSource";
import * as isVideo from 'is-video';
import * as isSubtitle from 'is-subtitle';

export class FileSystemMediaProvider extends BaseMediaProvider {
    readonly type : string = 'filesystem';

    WINDOWS_MATCH = /^[a-zA-Z]:(\\|\/)/;
    
    UNIX_MATCH = /^(\.|~)?\//;

    getMediaRepositories () : IMediaRepository[] {
        return [];
    }

    match ( source : string ) : boolean {
        return ( this.WINDOWS_MATCH.test( source ) || this.UNIX_MATCH.test( source ) ) && ( isVideo( source ) || isSubtitle( source ) );
    }

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : FileSystemMediaSource {
        return new FileSystemMediaSource( manager, this, source );
    }
}