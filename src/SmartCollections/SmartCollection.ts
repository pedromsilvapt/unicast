import { CollectionRecord } from '../Database/Database';
import { UnicastServer } from '../UnicastServer';

export interface ISmartCollection {
    readonly name : string;

    server : UnicastServer;

    update ( collection: CollectionRecord, options: unknown ) : Promise<void>;
}

export abstract class SmartCollection implements ISmartCollection {
    readonly name : string;

    server : UnicastServer;

    constructor ( name : string ) {
        this.name = name;
    }

    abstract update ( collection: CollectionRecord, options: unknown ) : Promise<void>;
}
