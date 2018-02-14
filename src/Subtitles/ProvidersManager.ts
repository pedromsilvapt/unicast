import { UnicastServer } from "../UnicastServer";
import { ISubtitlesProvider, ISubtitle } from "./Providers/ISubtitlesProvider";
import { EntityManager } from "../EntityManager";
import { MediaRecord } from "../MediaRecord";
import { SubtitlesCache } from "./SubtitlesCache";

export function flatten<T> ( items : T[][] ) : T[] {
    return items.reduce( ( a, b ) => a.concat( b ), [] );
}

export class SubtitlesProvidersManager extends EntityManager<ISubtitlesProvider, string> {
    server : UnicastServer;

    providers : Map<string, ISubtitlesProvider> = new Map;

    cache : SubtitlesCache = new SubtitlesCache;

    constructor ( server : UnicastServer ) {
        super( server );
    }

    protected getEntityKey ( entity : ISubtitlesProvider ) : string {
        return entity.name;
    }

    async search ( media : MediaRecord, langs : string[], providersNames : string[] = null ) : Promise<ISubtitle[]> {
        if ( !providersNames ) {
            providersNames = this.entities.map( provider => provider.name );
        }

        const invalid = providersNames.filter( name => !this.hasKeyed( name ) );

        if ( invalid.length ) {
            throw new Error( `Could not find providers named ${ invalid.join( ', ' ) }.` );
        }

        const providers = providersNames.map( name => this.get( name ) );

        const providersAndLangs = flatten( providers.map( provider => langs.map( lang => [ provider, lang ] as [ ISubtitlesProvider, string ] ) ) );

        return flatten<ISubtitle>( await Promise.all( 
            providersAndLangs.map( async ( [ provider, lang ] ) => {
                if ( this.cache.hasSearch( provider.name, lang, media ) ) {
                    return this.cache.getSearch( provider.name, lang, media );
                }

                const results = await provider.search( media, lang ).catch( error => {
                    this.server.diagnostics.error( 
                        'subtitles', 
                        error.message || `Error with subtitles provider "${ provider.name }" for record "${ media.title }".` ,
                        error
                    );

                    return [];
                } );

                this.cache.setSearch( provider.name, lang, media, results );
                
                return results;
            } )
        ) );
    }

    async download ( subtitle : ISubtitle ) : Promise<NodeJS.ReadableStream> {
        const provider = this.get( subtitle.provider );

        if ( !provider ) {
            throw new Error( `Trying to download subtitles from invalid provider ${ subtitle.provider }.` );
        }

        if ( this.cache.hasDownload( subtitle ) ) {
            return this.cache.getDownload( subtitle );
        }

        const stream = await provider.download( subtitle );

        this.cache.setDownload( subtitle, stream );
        
        return stream;
    }
}