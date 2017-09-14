import { CancelToken } from "../../ES2017/CancelToken";
import { ConfigInstances } from "../../Config";
import { KodiMediaProvider } from "./KodiMediaProvider";
import { ProviderFactory } from "../BaseMediaProvider/ProviderFactory";

export class KodiMediaProviderFactory extends ProviderFactory<KodiMediaProvider> {
    type: string = 'kodi';

    async * scan ( token ?: CancelToken ) : AsyncIterable<KodiMediaProvider> {
        // const instances = new ConfigInstances( this.server.config );

        // for ( let instance of instances.get( 'receivers', this.type, { key: 'list' } ) ) {
        //     yield this.createReceiver( instance );
        // }

        //yield new ChromecastReceiver( this.server, 'ChromecastSilvas', '192.168.0.60' );
    }

    async createFromConfig ( config : any ) : Promise<KodiMediaProvider> {
        return new KodiMediaProvider( config.name, config.address, config.port );
    }
}