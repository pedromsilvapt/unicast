import { IMediaReceiver } from "./IMediaReceiver";
import { UnicastServer } from "../../UnicastServer";
import { ConfigurableEntityFactory } from "../../EntityFactory";
import { ConfigInstances } from "../../Config";

export abstract class ReceiverFactory<R extends IMediaReceiver> extends ConfigurableEntityFactory<R> {
    readonly server : UnicastServer;

    abstract readonly type : string;

    constructor ( server : UnicastServer ) {
        super();

        this.server = server;
    }

    getEntitiesConfig () {
        return new ConfigInstances( this.server.config ).get( 'receivers', this.type );
    }
}