import { EntityFactoryManager, EntityManager } from "../EntityManager";
import { UnicastServer } from "../UnicastServer";
import { ICustomAction } from './CustomAction';
import { CustomActionFactory } from './CustomActionFactory';

export class CustomActionsManager extends EntityManager<ICustomAction, string> {    
    readonly factories : CustomActionFactoriesManager;

    constructor ( server : UnicastServer ) {
        super( server );

        this.factories = new CustomActionFactoriesManager( this, server );
    }

    protected getEntityKey ( entity : ICustomAction ) : string {
        return entity.name;
    }
}

export class CustomActionFactoriesManager extends EntityFactoryManager<ICustomAction, CustomActionsManager, CustomActionFactory<ICustomAction>, string, string> {
    constructor ( customActions : CustomActionsManager, server : UnicastServer ) {
        super( customActions, server );
    }

    protected getEntityKey ( entity : CustomActionFactory<ICustomAction> ) : string {
        return entity.type;
    }
}
