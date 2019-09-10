import { ChromecastReceiver, ChromecastConfig } from "./ChromecastReceiver";
import { ReceiverFactory } from "../../../Receivers/BaseReceiver/ReceiverFactory";
import { ChromecastReceiverMDNSScanner } from "./ChromecastReceiverScanner";
import { CancelToken } from "data-cancel-token";
import { ObjectTypeSchema, OptionalTypeSchema, AnyTypeSchema } from "../../../Config";

export var ChromecastConfigTemplate = new ObjectTypeSchema( {
    subtitles: new OptionalTypeSchema( {
        lineFilters: new OptionalTypeSchema( [ new AnyTypeSchema() ], [] ),
        delay: new OptionalTypeSchema( {
            preloadCount: new OptionalTypeSchema( Number, 0 ),
            duration: new OptionalTypeSchema( Number, 250 ),
            rollback: new OptionalTypeSchema( Number, 2 )
        }, {} ),
        style: new OptionalTypeSchema( {
            default: new OptionalTypeSchema( {}, {} ),
            custom: new OptionalTypeSchema( [], null )
        }, {} )
    }, {} )
} );

export class ChromecastReceiverFactory extends ReceiverFactory<ChromecastReceiver> {
    type: string = 'chromecast';

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

    runTemplate ( config : any ) : ChromecastConfig {
        let errors = ChromecastConfigTemplate.validate( config );

        if ( errors !== null ) {
            if ( !( errors instanceof Array ) ) {
                errors = [ errors ];
            }

            throw new Error( `Could not validate config for a device.\n${ errors.map( err => err.message ).join( '\n' ) }` );
        }

        return ChromecastConfigTemplate.run( config );
    }

    async * entitiesFromScan ( existingDevices : ChromecastReceiver[], cancel : CancelToken ) : AsyncIterable<ChromecastReceiver> {
        const scanner = new ChromecastReceiverMDNSScanner( this.server.logger );

        scanner.missedConnectionsThreshold = 6;

        scanner.rememberDevices = true;

        for ( let device of existingDevices ) {
            scanner.addDevice( device.name, device.address );
        }
        
        for await ( let device of scanner.devices() ) {
            if ( device.status === "online" ) {
                let config = this.findConfigFor( device.name );

                config = this.inheritConfig( config );

                config = this.runTemplate( config );

                // TODO Allow to associate configurations with devices names on the config file, without an IP address
                // So that when a new device is discovered, the config file is searched for any device with such name 
                yield new ChromecastReceiver( this.server, device.name, device.address, config );
            }
        }
    }

    async createFromConfig ( config : any ) : Promise<ChromecastReceiver> {
        config = this.inheritConfig( config );

        config = this.runTemplate( config );

        return new ChromecastReceiver( this.server, config.name, config.address, config );
    }
}