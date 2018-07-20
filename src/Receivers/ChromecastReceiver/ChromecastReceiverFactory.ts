import { ChromecastReceiver } from "./ChromecastReceiver";
import { ReceiverFactory } from "../BaseReceiver/ReceiverFactory";
import { ConfigInstances } from "../../Config";
import { ChromecastReceiverSSDPScanner, ChromecastReceiverMDNSScanner } from "./ChromecastReceiverScanner";
import { CancelToken } from "data-cancel-token";

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
                yield new ChromecastReceiver( this.server, device.name, device.address );
            }
        }
    }

    async createFromConfig ( config : any ) : Promise<ChromecastReceiver> {
        return new ChromecastReceiver( this.server, config.name, config.address, config.subtitles || {} );
    }
}