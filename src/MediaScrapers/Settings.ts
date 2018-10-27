import { Cache, CacheStorage } from "./ScraperCache";

export class Settings {
    persistence : Cache<any>;

    constructor ( file : string ) {
        this.persistence = new Cache<any>();

        this.persistence.defaultTtl = 0;

        this.persistence.storage = new CacheStorage( file );

        this.persistence.autoSaveDelay = 500;
    }

    get<T = any> ( key : string | string[], defaultValue : T = null ) : T {
        if ( typeof key === 'string' ) key = key.split( '.' );

        if ( key.length === 0 ) {
            return defaultValue;
        }

        const [ head, ...tail ] = key;

        if ( !this.persistence.has( head ) ) {
            return defaultValue;
        }

        let container = this.persistence.get( head );

        for ( let subKey of tail ) {
            if ( !container ) {
                return defaultValue;
            }

            if ( !( subKey in container ) ) {
                return defaultValue;
            }
            
            container = container[ subKey ];
        }

        return container;
    }

    set ( key : string | string[], value : any ) {
        if ( typeof key === 'string' ) key = key.split( '.' );

        if ( key.length === 0 ) {
            throw new Error( `Cannot set value in settings without a key.` );
        }

        const [ head, ...tail ] = key;

        let container = this.persistence.get( head );
        
        if ( !container ) {
            container = {};
        }

        // We save the root so later we can save it back to the persistence
        const root = container;

        for ( let i = 0; i < tail.length; i++ ) {
            if ( i == tail.length - 1 ) {
                container[ tail[ i ] ] = value;
            } else {
                if ( !container[ tail[ i ] ] ) {
                    container[ tail[ i ] ] = {};
                }
    
                container = container[ tail[ i ] ];
            }
        }

        this.persistence.set( head, root );
    }

    async load () : Promise<void> {
        await this.persistence.load();
    }
}