import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IMediaReceiver } from "./BaseReceiver/IMediaReceiver";
import { UnicastServer } from "../UnicastServer";
import { ReceiverFactory } from "./BaseReceiver/ReceiverFactory";

export class ReceiversManager extends EntityManager<IMediaReceiver, string> {
    readonly factories : ReceiverFactoriesManager;

    constructor ( server : UnicastServer ) {
        super( server );

        this.factories = new ReceiverFactoriesManager( this, server );
    }

    protected getEntityKey ( entity : IMediaReceiver ) : string {
        return entity.name;
    }
}

export class ReceiverFactoriesManager extends EntityFactoryManager<IMediaReceiver, ReceiversManager, ReceiverFactory<IMediaReceiver>, string, string> {
    constructor ( receivers : ReceiversManager, server : UnicastServer ) {
        super( receivers, server );

        this.server.onListen.subscribe( () => {
            // Before the HTTP server starts listening, register the high 
            // frequency url
            this.server.httpLoggerMiddleware.registerHighFrequencyPattern(
                /\/api\/player\/(\w+)\/status/i,
                match => match[ 1 ]
            );
        } );
    }

    protected getEntityKey ( entity : ReceiverFactory<IMediaReceiver> ) : string {
        return entity.type;
    }
}