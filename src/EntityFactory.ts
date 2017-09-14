import { EventEmitter } from "events";
import { EntityManager } from "./EntityManager";
import { CancelToken } from "./ES2017/CancelToken";
import { toIterable, merge } from "./ES2017/AsyncIterable";

export abstract class EntityFactory<E> {
    abstract entities ( cancel : CancelToken ) : AsyncIterable<E>;
}

export abstract class ConfigurableEntityFactory<E> extends EntityFactory<E> {
    abstract getEntitiesConfig () : any[];

    entities ( cancel : CancelToken ) : AsyncIterable<E> {
        return merge( [ this.entitiesFromConfig( cancel ), this.entitiesFromScan( cancel ) ], cancel );
    }

    entitiesFromConfig ( cancel : CancelToken ) : AsyncIterable<E> {
        const entities : Promise<E>[] = [];

        for ( let config of this.getEntitiesConfig() ) {
            entities.push( this.createFromConfig( config ) );
        }

        return toIterable( entities );
    }

    async * entitiesFromScan ( cancel : CancelToken ) : AsyncIterable<E> {}

    abstract createFromConfig ( config : any ) : Promise<E>;
}
