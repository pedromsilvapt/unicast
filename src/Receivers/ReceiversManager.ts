import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IMediaReceiver } from "./BaseReceiver/IMediaReceiver";
import { UnicastServer } from "../UnicastServer";
import { ReceiverFactory } from "./BaseReceiver/ReceiverFactory";
import { CancelToken } from "../ES2017/CancelToken";

export class ReceiversManager extends EntityManager<IMediaReceiver, string> {
    readonly server : UnicastServer;

    readonly factories : ReceiverFactoriesManager;

    constructor ( server : UnicastServer ) {
        super();

        this.server = server;

        this.factories = new ReceiverFactoriesManager( this );
    }

    protected getEntityKey ( entity : IMediaReceiver ) : string {
        return entity.name;
    }
}

export class ReceiverFactoriesManager extends EntityFactoryManager<IMediaReceiver, ReceiversManager, ReceiverFactory<IMediaReceiver>, string, string> {
    constructor ( receivers : ReceiversManager ) {
        super( receivers );
    }

    protected getEntityKey ( entity : ReceiverFactory<IMediaReceiver> ) : string {
        return entity.type;
    }
}