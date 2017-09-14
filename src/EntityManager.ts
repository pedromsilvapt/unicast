import { EventEmitter } from "events";
import { CancelToken } from "./ES2017/CancelToken";
import { EntityFactory } from "./EntityFactory";

export abstract class EntityManager<E, K = E> extends EventEmitter {
    protected entities : E[] = [];

    protected abstract getEntityKey ( entity : E ) : K;

    add ( entity : E ) : this {
        this.entities.push( entity );

        this.emit( 'entity-added', entity, this.getEntityKey( entity ) );

        return this;
    }

    delete ( entity : E ) : this {
        const index = this.entities.findIndex( e => this.getEntityKey( e ) === this.getEntityKey( entity ) );

        if ( index >= 0 ) {
            this.entities.splice( index, 1 );

            this.emit( 'entity-removed', entity, this.getEntityKey( entity ) );
        }

        return this;
    }

    has ( entity : E ) : boolean {
        return this.entities.find( e => this.getEntityKey( e ) === this.getEntityKey( entity ) ) != null;
    }

    get ( entity : K ) : E {
        return this.entities.find( e => this.getEntityKey( e ) === entity );
    }

    * keys () : IterableIterator<K> {
        yield * this.entities.map( entity => this.getEntityKey( entity ) );
    }

    * entries () : IterableIterator<[K, E]> {
        for ( let entity of this.entities ) {
            yield [ this.getEntityKey( entity ), entity ];
        }
    }

    * [Symbol.iterator] () : IterableIterator<E> {
        yield * this.entities;
    }
}

export abstract class EntityFactoryManager<E, M extends EntityManager<E, K>, F extends EntityFactory<E>, T, K> extends EntityManager<F, T> {
    entitiesManager : M;

    cancellations : Map<T, CancelToken> = new Map;    

    constructor ( entities : M ) {
        super();

        this.entitiesManager = entities;
    }

    protected async scanFactory ( factory : F ) {
        const cancel = new CancelToken();
        
        this.cancellations.set( this.getEntityKey( factory ), cancel );

        try {
            for await ( let entity of factory.entities( cancel ) ) {
                if ( !cancel.isCancelled() ) {
                    this.entitiesManager.add( entity )
                }
            }
        } catch ( error ) {
            console.error( error );
        }

        this.cancellations.delete( this.getEntityKey( factory ) );
    }

    add ( factory : F ) : this {
        super.add( factory );
        
        this.scanFactory( factory ).catch( error => console.error( error ) );

        return this;
    }

    delete ( factory : F ) : this {
        super.delete( factory );

        if ( this.cancellations.has( this.getEntityKey( factory ) ) ) {
            this.cancellations.get( this.getEntityKey( factory ) ).cancel();

            this.cancellations.delete( this.getEntityKey( factory ) );
        }

        return this;
    }
}