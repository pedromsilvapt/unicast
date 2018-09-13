import { MediaSource, MediaSourceDetails } from "./MediaSource";
import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IMediaProvider } from "./BaseMediaProvider/IMediaProvider";
import { MediaStream } from "./MediaStreams/MediaStream";
import { MediaRecord } from "../MediaRecord";
import { ProviderFactory } from "./BaseMediaProvider/ProviderFactory";
import { UnicastServer } from "../UnicastServer";

export type MediaSourceLike = string | MediaSourceDetails | ( string | MediaSourceDetails )[];

export interface CacheOptions {
    readCache ?: boolean;
    writeCache ?: boolean;
}

export class ProvidersManager extends EntityManager<IMediaProvider, string> {
    protected cached : { [ property : string ] : MediaSource } = {};

    readonly factories : ProviderFactoriesManager;

    constructor ( server : UnicastServer ) {
        super( server );

        this.factories = new ProviderFactoriesManager( this, server );        
    }

    add ( entity : IMediaProvider ) : this {
        super.add( entity );

        return this;
    }

    delete ( entity : IMediaProvider ) : this {
        super.delete( entity );

        return this;
    }

    protected getEntityKey ( provider : IMediaProvider ) {
        return provider.type;
    }

    normalizeSources ( sources : string | MediaSourceDetails | (string | MediaSourceDetails)[] ) : MediaSourceDetails[] {
        if ( !( sources instanceof Array ) ) {
            return this.normalizeSources( [ sources ] );
        }

        return sources.map( source => typeof source === 'string' ? { id: source } : source );
    }

    /**
     * Finds a provider that accepts the requested source.
     * 
     * @param {MediaSourceDetails} source 
     * @returns {IMediaProvider} 
     * @memberof ProvidersManager
     */
    match ( source : MediaSourceDetails ) : IMediaProvider {
        if ( source.provider ) {
            return this.get( source.provider );
        }

        return this.entities.find( provider => provider.match( source.id ) );
    }
    
    make ( provider : IMediaProvider, source : MediaSourceDetails ) : MediaSource {
        return provider.make( this, source );
    }

    forgetAll () {
        this.cached = {};
    }

    forget ( source : MediaSourceLike ) : void {
        if ( source instanceof Array ) {
            source.map( this.forget, this );
        } else {
            if ( typeof source === 'string' ) {
                source = { id: source } as MediaSourceDetails;
            }

            // Find the provider type associated with this source.
            // Note this is the provider type (the class), not the instance of the provider yet
            const provider : IMediaProvider = this.match( source );

            // Make sure we found a provider
            if ( !provider ) {
                throw new Error( `Could not find a provider for "${ source.id }"` );
            }

            // Asks the provider for a cache key for this source (should be unique)
            const cacheKey : string = provider.cacheKey( source );

            // If the resource is already cached, return it
            if ( cacheKey && cacheKey in this.cached ) {
                delete this.cached[ cacheKey ];
            }
        }
    }

    async open ( source : (string | MediaSourceDetails)[], cacheOptions ?: CacheOptions ) : Promise<MediaSource[]>;
    async open ( source : string | MediaSourceDetails, cacheOptions ?: CacheOptions ) : Promise<MediaSource> ;
    async open ( source : MediaSourceLike, cacheOptions : CacheOptions = {} ) : Promise<MediaSource[] | MediaSource> {
        if ( source instanceof Array ) {
            return Promise.all( source.map( source => this.open( source, cacheOptions ) ) );
        }

        cacheOptions = { readCache: true, writeCache: true, ...cacheOptions };

        if ( typeof source === 'string' ) {
            source = { id: source } as MediaSourceDetails;
        }

        // Find the provider type associated with this source.
        // Note this is the provider type (the class), not the instance of the provider yet
        const provider : IMediaProvider = this.match( source );

        // Make sure we found a provider
        if ( !provider ) {
            throw new Error( `Could not find a provider for "${ source.id }"` );
        }

        // Asks the provider for a cache key for this source (should be unique)
        const cacheKey : string = provider.cacheKey( source );

        // If the resource is already cached, return it
        if ( cacheKey && cacheKey in this.cached && cacheOptions.readCache ) {
            return this.cached[ cacheKey ].load();
        }

        // Otherwise create the instance of the provider
        const instance = this.make( provider, source );

        // And if possible use the cache key to save the resource
        if ( cacheKey && cacheOptions.writeCache ) {
            this.cached[ cacheKey ] = instance;
        }

        return instance.load();
    }

    async streams ( sourcesList : string | MediaSourceDetails | ( string | MediaSourceDetails )[], cacheOptions : CacheOptions = {} ) : Promise<MediaStream[]> {
        const sources = await this.open( sourcesList as any, cacheOptions ) as MediaSource | MediaSource[];

        if ( sources instanceof Array ) {
            return sources.reduce( ( memo, source ) => memo.concat( source.streams ), [] );
        }

        return sources.streams;
    }

    async getMediaRecordFor ( sourcesList : MediaSourceDetails[], cacheOptions : CacheOptions = {} ) : Promise<MediaRecord> {
        const primary = sourcesList.find( source => typeof source !== 'string' && source.primary );

        const selected = primary || sourcesList[ 0 ];

        if ( selected !== null ) {
            const source = await this.open( selected, cacheOptions );

            return source.info();
        }

        return null;
    }
}


export class ProviderFactoriesManager extends EntityFactoryManager<IMediaProvider, ProvidersManager, ProviderFactory<IMediaProvider>, string, string> {
    constructor ( receivers : ProvidersManager, server : UnicastServer ) {
        super( receivers, server );
    }

    protected getEntityKey ( entity : ProviderFactory<IMediaProvider> ) : string {
        return entity.type;
    }
}