import { ReceiverFactory } from '../../../Receivers/BaseReceiver/ReceiverFactory';
import { MpvReceiver } from './MpvReceiver';
import { CancelToken } from 'data-cancel-token';

// export var ChromecastConfigTemplate = new ObjectTypeSchema( {
//     subtitles: new OptionalTypeSchema( {
//         lineFilters: new OptionalTypeSchema( [ new AnyTypeSchema() ], [] ),
//         delay: new OptionalTypeSchema( {
//             preloadCount: new OptionalTypeSchema( Number, 0 ),
//             duration: new OptionalTypeSchema( Number, 250 ),
//             rollback: new OptionalTypeSchema( Number, 2 )
//         }, {} ),
//         style: new OptionalTypeSchema( {
//             default: new OptionalTypeSchema( {}, {} ),
//             custom: new OptionalTypeSchema( [], null )
//         }, {} )
//     }, {} )
// } );

export class MpvReceiverFactory extends ReceiverFactory<MpvReceiver> {
    type: string = 'mpv';

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

    async * entitiesFromScan ( existingDevices : MpvReceiver[], cancel : CancelToken ) : AsyncIterable<MpvReceiver> {
        
    }

    async createFromConfig ( config : any ) : Promise<MpvReceiver> {
        config = this.inheritConfig( config );

        return new MpvReceiver( this.server, config.name, config.address, config.port || 2019, config );
    }
}