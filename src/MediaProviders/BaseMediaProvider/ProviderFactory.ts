import { UnicastServer } from "../../UnicastServer";
import { ConfigurableEntityFactory } from "../../EntityFactory";
import { ConfigInstances } from "../../Config";
import { IMediaProvider } from "./IMediaProvider";

export abstract class ProviderFactory<P extends IMediaProvider> extends ConfigurableEntityFactory<P> {
    readonly server : UnicastServer;

    abstract readonly type : string;

    constructor ( server : UnicastServer ) {
        super();

        this.server = server;
    }

    getDefaultsConfig () : any[] {
        return [];
    }

    getEntitiesConfig () {
        return new ConfigInstances( this.server.config ).get( 'providers', this.type, {
            defaults: this.getDefaultsConfig()
        } );
    }
}