import { MediaStream, MediaStreamType } from "./MediaStreams/MediaStream";
import { IMediaProvider } from "./BaseMediaProvider/IMediaProvider";
import { ProvidersManager } from "./ProvidersManager";
import { PlayableMediaRecord } from "../MediaRecord";
import { MediaTools } from '../MediaTools';

export interface MediaSourceDetails {
    id : string;
    provider ?: string;
    // TODO I honestly don't remember what this was for???
    // constraints ?: Array<Constraint>;
    primary ?: boolean;
    types ?: MediaStreamType | MediaStreamType[];
    take ?: number;
    skip ?: number;

    enabled ?: string | string[];
    disabled ?: string | string[];

    scraper ?: string;

    [ property : string ] : any;
}

export abstract class MediaSource {
    loading : Promise<this> = null;

    manager : ProvidersManager;

    mediaTools : MediaTools;

    provider : IMediaProvider;

    details : MediaSourceDetails;

    streams : Array<MediaStream> = [];

    constructor ( manager : ProvidersManager, mediaTools : MediaTools, provider : IMediaProvider, details : MediaSourceDetails ) {
        this.manager = manager;
        this.mediaTools = mediaTools;
        this.provider = provider;
        this.details = details;
    }

    isStreamEnabled ( type : MediaStreamType, id : string, enabled : boolean = true ) : boolean {
        const details = this.details;

        if ( details.types && enabled ) {
            const enabledTypes = typeof details.types === 'string' ? [ details.types ] : details.types;

            if ( !enabledTypes.includes( type ) ) {
                return false;
            }
        }

        if ( details.enabled ) {
            const enabledIds = typeof details.enabled === 'string' ? [ details.enabled ] : details.enabled;

            if ( !enabledIds.includes( id ) ) {
                return false;
            }
        }

        if ( details.disabled ) {
            const disabledIds = typeof details.disabled === 'string' ? [ details.disabled ] : details.disabled;

            if ( disabledIds.includes( id ) ) {
                return false;
            }
        }

        return enabled;
    }

    abstract scan ? () : Promise<MediaStream[]>;

    async init () {
        if ( this.scan ) {
            let streams = await this.scan();

            for ( let stream of streams ) {
                stream.enabled = this.isStreamEnabled( stream.type, stream.id, stream.enabled );

                if ( stream.init ) {
                    await stream.init( this.mediaTools );
                }

                this.streams.push( stream );
            }
        }
    }

    async load () : Promise<this> {
        if ( this.loading ) {
            return this.loading;
        }

        this.loading = this.init().then( () => this );

        return this.loading;
    }

    abstract info () : Promise<PlayableMediaRecord>;
}
