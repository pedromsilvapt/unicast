import { ReceiverFactory } from '../../../Receivers/BaseReceiver/ReceiverFactory';
import { KodiReceiver, KodiConfig } from './KodiReceiver';
import { CancelToken } from 'data-cancel-token';
import * as schema from '@gallant/schema';

export var KodiConfigTemplate = schema.parse( `{
    username?: string;
    password?: string;
    fallback?: string;
    subtitles?: {
        lineFilters?: any[]; // = []
        style?: {
            default: Object; // = {}
            custom: Object[]; // = null
        }; // = {}
    }; // = {}
    [key: any]: any;
}` );

export class KodiReceiverFactory extends ReceiverFactory<KodiReceiver> {
    type: string = 'kodi';

    entityIsVirtual ( config : any ) : boolean {
        return config.address == null;
    }

    findConfigFor ( name : string ) {
        return this.virtuals.find( config => config.name == name );
    }

    inheritConfig ( config : any, parent ?: string ) {
        config = config || {};

        // If no explicit parent is provided, we look at the config we want to extend
        // and search for the `inherit : string | string[]` property
        // which should have the names of the parents to inherit from
        if ( !parent ) {
            if ( typeof config.inherit === 'string' ) {
                config = this.inheritConfig( config, config.inherit );
            } else if ( config.inherit instanceof Array ) {
                for ( let parent of config.inherit ) {
                    if ( parent ) {
                        config = this.inheritConfig( config, parent );
                    }
                }
            }
        } else {
            const parentConfig = this.inheritConfig( this.findConfigFor( parent ) );

            // TODO Should make the merge be deep (merge sub-objects and so on)
            config = { ...parentConfig, ...config };
        }

        return config;
    }

    runTemplate ( config : any ) : KodiConfig {
        let errors = KodiConfigTemplate.validate( config );

        if ( errors !== null ) {
            if ( !( errors instanceof Array ) ) {
                errors = [ errors ];
            }

            throw new Error( `Could not validate config for a device.\n${ errors.map( err => err.message ).join( '\n' ) }` );
        }

        return KodiConfigTemplate.run( config );
    }

    async * entitiesFromScan ( existingDevices : KodiReceiver[], cancel : CancelToken ) : AsyncIterable<KodiReceiver> {
        
    }

    async createFromConfig ( config : any ) : Promise<KodiReceiver> {
        config = this.inheritConfig( config );

        config = this.runTemplate( config );

        return new KodiReceiver( this.server, config.name, config.address, config.port || 2019, config );
    }
}