import { MediaSource, MediaSourceDetails } from "../MediaSource";
import { ProvidersManager } from "../ProvidersManager";
import { IMediaRepository } from "../../MediaRepositories/BaseRepository/IMediaRepository";

export interface IMediaProviderFactory<P extends IMediaProvider> {
    load () : Promise<P[]>;
}

export interface IMediaProvider {
    readonly name : string;
    
    readonly type : string;

    getMediaRepositories () : IMediaRepository[];

    cacheKey ( source : MediaSourceDetails ) : string;

    match ( source : string ) : boolean;

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : MediaSource;

    open ( manager : ProvidersManager, source : MediaSourceDetails ) : Promise<MediaSource>;
}