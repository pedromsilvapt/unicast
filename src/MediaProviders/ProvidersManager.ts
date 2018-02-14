import { MediaSource, MediaSourceDetails } from "./MediaSource";
import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IMediaProvider } from "./BaseMediaProvider/IMediaProvider";
import { MediaStream } from "./MediaStreams/MediaStream";
import { MediaRecord } from "../MediaRecord";
import { RepositoriesManager } from "../MediaRepositories/RepositoriesManager";
import { ProviderFactory } from "./BaseMediaProvider/ProviderFactory";
import { UnicastServer } from "../UnicastServer";

export class ProvidersManager extends EntityManager<IMediaProvider, string> {
    protected cached : { [ property : string ] : MediaSource } = {};

    readonly factories : ProviderFactoriesManager;

    repositories : RepositoriesManager;

    constructor ( server : UnicastServer ) {
        super( server );

        this.repositories = new RepositoriesManager();

        this.factories = new ProviderFactoriesManager( this, server );        
    }

    add ( entity : IMediaProvider ) : this {
        super.add( entity );

        this.repositories.addMany( entity.getMediaRepositories() );

        return this;
    }

    
    delete ( entity : IMediaProvider ) : this {
        super.delete( entity );

        this.repositories.deleteMany( entity.getMediaRepositories() );
        
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

    async open ( source : (string | MediaSourceDetails)[] ) : Promise<MediaSource[]>;
    async open ( source : string | MediaSourceDetails ) : Promise<MediaSource> ;
    async open ( source : string | MediaSourceDetails | ( string | MediaSourceDetails )[] ) : Promise<MediaSource[] | MediaSource> {
        if ( source instanceof Array ) {
            return Promise.all( source.map( this.open, this ) );
        }

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
            return this.cached[ cacheKey ].load();
        }

        // Otherwise create the instance of the provider
        const instance = this.make( provider, source );

        // And if possible use the cache key to save the resource
        if ( cacheKey ) {
            this.cached[ cacheKey ] = instance;
        }

        return instance.load();
    }

    async streams ( sourcesList : string | MediaSourceDetails | ( string | MediaSourceDetails )[] ) : Promise<MediaStream[]> {
        const sources = await this.open( sourcesList as any ) as MediaSource | MediaSource[];

        if ( sources instanceof Array ) {
            return sources.reduce( ( memo, source ) => memo.concat( source.streams ), [] );
        }

        return sources.streams;
    }

    async getMediaRecordFor ( sourcesList : MediaSourceDetails[] ) : Promise<MediaRecord> {
        const primary = sourcesList.find( source => typeof source !== 'string' && source.primary );

        const selected = primary || sourcesList[ 0 ];

        if ( selected !== null ) {
            const source = await this.open( selected );

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