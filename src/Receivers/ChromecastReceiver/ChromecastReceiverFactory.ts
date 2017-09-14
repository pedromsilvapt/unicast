import { ChromecastReceiver } from "./ChromecastReceiver";
import { ReceiverFactory } from "../BaseReceiver/ReceiverFactory";
import { CancelToken } from "../../ES2017/CancelToken";
import { ConfigInstances } from "../../Config";

export class ChromecastReceiverFactory extends ReceiverFactory<ChromecastReceiver> {
    type: string = 'chromecast';

    async * scan ( token ?: CancelToken ) : AsyncIterable<ChromecastReceiver> {
        // const instances = new ConfigInstances( this.server.config );

        // for ( let instance of instances.get( 'receivers', this.type, { key: 'list' } ) ) {
        //     yield this.createReceiver( instance );
        // }

        //yield new ChromecastReceiver( this.server, 'ChromecastSilvas', '192.168.0.60' );
    }

    async * entitiesFromScan( cancel : CancelToken ) : AsyncIterable<ChromecastReceiver> {
        
    }

    async createFromConfig ( config : any ) : Promise<ChromecastReceiver> {
        return new ChromecastReceiver( this.server, config.name, config.address );
    }
}