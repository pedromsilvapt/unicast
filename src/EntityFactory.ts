import { EventEmitter } from "events";
import { EntityManager } from "./EntityManager";
import { fromPromises, CancelToken } from 'data-async-iterators';
import { UnicastServer } from "./UnicastServer";

export class IEntity {
    server : UnicastServer;

    onEntityInit ? ();

    onEntityDestroy ? ();
}

export abstract class EntityFactory<E extends IEntity> extends IEntity {
    server : UnicastServer;

    abstract entities ( cancel : CancelToken ) : AsyncIterable<E>;
}

export abstract class ConfigurableEntityFactory<E extends IEntity> extends EntityFactory<E> {
    virtuals : any[] = [];

    abstract getEntitiesConfig () : any[];

    async * entities ( cancel : CancelToken ) : AsyncIterable<E> {
        const devices : E[] = [];

        for await ( let device of this.entitiesFromConfig( cancel ) ) {
            devices.push( device );
            
            yield device;
        }

        yield * this.entitiesFromScan( devices, cancel );
    }

    entityIsVirtual ( config : any ) : boolean {
        return false;
    }

    entitiesFromConfig ( cancel : CancelToken ) : AsyncIterable<E> {
        const entities : Promise<E>[] = [];

        for ( let config of this.getEntitiesConfig() ) {
            if ( this.entityIsVirtual( config ) ) {
                this.virtuals.push( config );
            } else {
                entities.push( this.createFromConfig( config ) );
            }
        }

        return fromPromises( entities );
    }

    async * entitiesFromScan ( hardcoded : E[], cancel : CancelToken ) : AsyncIterable<E> {}

    abstract createFromConfig ( config : any ) : Promise<E>;
}
