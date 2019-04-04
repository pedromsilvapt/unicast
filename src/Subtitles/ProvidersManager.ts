import { UnicastServer } from "../UnicastServer";
import { ISubtitlesProvider, ISubtitle } from "./Providers/ISubtitlesProvider";
import { EntityManager } from "../EntityManager";
import { PlayableMediaRecord } from "../MediaRecord";
import { SubtitlesCache } from "./SubtitlesCache";
import * as sortBy from 'sort-by';

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

    // Returns an array of user languages to be used when searching for subtitles and the user hasn't asked for any in specific
    getDefaultLanguages () : string[] {
        const primaryLanguage = this.server.config.get( 'primaryLanguage', null );

        if ( primaryLanguage ) {
            return [ primaryLanguage ];
        }

        return this.server.config.get( 'secondaryLanguages', [] );
    }

    async search ( media : PlayableMediaRecord, langs : string[], providersNames : string[] = null ) : Promise<ISubtitle[]> {
        if ( !providersNames ) {
            providersNames = this.entities.map( provider => provider.name );
        }

        if ( !langs || langs.length == 0 ) {
            langs = this.getDefaultLanguages();
        }

        const invalid = providersNames.filter( name => !this.hasKeyed( name ) );

        if ( invalid.length ) {
            throw new Error( `Could not find providers named ${ invalid.join( ', ' ) }.` );
        }

        const providers = providersNames.map( name => this.get( name ) );

        const providersAndLangs = flatten( providers.map( provider => langs.map( lang => [ provider, lang ] as [ ISubtitlesProvider, string ] ) ) );

        return flatten<ISubtitle>( await Promise.all( 
            providersAndLangs.map( ( [ provider, lang ] ) => this.cache.wrapSearch( provider.name, lang, media, () => {
                return provider.search( media, lang ).catch( error => {
                    this.server.logger.error( 
                        'subtitles', 
                        error.message ? `Provider ${provider.name}: ${ error.message }` : `Error with subtitles provider "${ provider.name }" for record "${ media.title }".`,
                        error
                    );

                    return [];
                } );
            } ) )
        ) ).sort( sortBy( '-score' ) );
    }

    async download ( subtitle : ISubtitle ) : Promise<NodeJS.ReadableStream> {
        const provider = this.get( subtitle.provider );

        if ( !provider ) {
            throw new Error( `Trying to download subtitles from invalid provider ${ subtitle.provider }.` );
        }

        return this.cache.wrapDownload( subtitle, () => provider.download( subtitle ) );
    }
}