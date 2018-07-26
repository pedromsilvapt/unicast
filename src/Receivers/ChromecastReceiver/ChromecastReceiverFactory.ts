import { ChromecastReceiver } from "./ChromecastReceiver";
import { ReceiverFactory } from "../BaseReceiver/ReceiverFactory";
import { ChromecastReceiverMDNSScanner } from "./ChromecastReceiverScanner";
import { CancelToken } from "data-cancel-token";
import { ObjectTypeSchema, OptionalTypeSchema, AnyTypeSchema } from "../../Config";

export var ChromecastConfigTemplate = new ObjectTypeSchema( {
    subtitles: new OptionalTypeSchema( {
        lineFilters: new OptionalTypeSchema( [ new AnyTypeSchema() ], [] ),
        delay: new OptionalTypeSchema( {
            preloadCount: new OptionalTypeSchema( Number, 0 ),
            duration: new OptionalTypeSchema( Number, 250 )
        }, {} ),
        style: new OptionalTypeSchema( {
            default: new OptionalTypeSchema( {}, {} ),
            custom: new OptionalTypeSchema( [], null )
        }, {} )
    }, {} )
} );

export class ChromecastReceiverFactory extends ReceiverFactory<ChromecastReceiver> {
    type: string = 'chromecast';

    async * entitiesFromScan ( existingDevices : ChromecastReceiver[], cancel : CancelToken ) : AsyncIterable<ChromecastReceiver> {
        const scanner = new ChromecastReceiverMDNSScanner( this.server.diagnostics );

        scanner.missedConnectionsThreshold = 6;

        scanner.rememberDevices = true;

        for ( let device of existingDevices ) {
            scanner.addDevice( device.name, device.address );
        }
        
        for await ( let device of scanner.devices() ) {
            if ( device.status === "online" ) {
                // TODO Allow to associate configurations with devices names on the config file, without an IP address
                // So that when a new device is discovered, the config file is searched for any device with such name 
                yield new ChromecastReceiver( this.server, device.name, device.address, { subtitles: {} as any } );
            }
        }
    }

    async createFromConfig ( config : any ) : Promise<ChromecastReceiver> {
        return new ChromecastReceiver( this.server, config.name, config.address, ChromecastConfigTemplate.run( { subtitles: config.subtitles } ) );
    }
}