import { IMediaProvider } from "./IMediaProvider";
import { MediaSource, MediaSourceDetails } from "../MediaSource";
import { ProvidersManager } from "../ProvidersManager";
import { UnicastServer } from "../../UnicastServer";

export abstract class BaseMediaProvider implements IMediaProvider {
    server : UnicastServer;

    abstract readonly type : string;

    readonly name : string;

    constructor ( name ?: string ) {
        if ( name ) {
            this.name = name;
        }
    }

    cacheKey ( source : MediaSourceDetails ) : string {
        return source.id;
    }

    abstract match ( source : string ) : boolean;

    abstract make ( manager : ProvidersManager, source : MediaSourceDetails ) : MediaSource;
    
    open ( manager : ProvidersManager, source : MediaSourceDetails ) : Promise<MediaSource> {
        return this.make( manager, source ).load();
    }
}