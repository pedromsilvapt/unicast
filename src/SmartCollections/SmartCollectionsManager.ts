import { EntityManager } from "../EntityManager";
import { UnicastServer } from "../UnicastServer";
import { ISmartCollection } from './SmartCollection';

export class SmartCollectionsManager extends EntityManager<ISmartCollection, string> {
    constructor ( server : UnicastServer ) {
        super( server );
    }

    protected getEntityKey ( entity : ISmartCollection ) : string {
        return entity.name;
    }
}
