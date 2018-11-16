import { EventEmitter } from "events";
import { CancelToken } from 'data-cancel-token';
import { EntityFactory, IEntity } from "./EntityFactory";
import { UnicastServer } from "./UnicastServer";

export abstract class EntityManager<E extends IEntity, K = E> extends EventEmitter {
    server : UnicastServer;

    constructor ( server : UnicastServer ) {
        super();
        
        this.server = server;

        this.server.onClose.subscribe( this.destroy.bind( this ) );
    }

    protected entities : E[] = [];

    protected abstract getEntityKey ( entity : E ) : K;

    add ( entity : E ) : this {
        this.entities.push( entity );

        entity.server = this.server;

        if ( entity.onEntityInit ) {
            entity.onEntityInit();
        }

        this.emit( 'entity-added', entity, this.getEntityKey( entity ) );

        return this;
    }

    delete ( entity : E ) : this {
        const index = this.entities.findIndex( e => this.getEntityKey( e ) === this.getEntityKey( entity ) );

        if ( index >= 0 ) {
            this.entities.splice( index, 1 );

            if ( entity.onEntityDestroy ) {
                entity.onEntityDestroy();
            }

            this.emit( 'entity-removed', entity, this.getEntityKey( entity ) );
        }

        return this;
    }

    hasKeyed ( key : K ) : boolean {
        return this.entities.find( e => this.getEntityKey( e ) === key ) != null;
    }

    has ( entity : E ) : boolean {
        return this.entities.find( e => this.getEntityKey( e ) === this.getEntityKey( entity ) ) != null;
    }

    get ( entity : K ) : E {
        return this.entities.find( e => this.getEntityKey( e ) === entity );
    }

    destroy () {
        for ( let entity of this ) {
            this.delete( entity );
        }
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

export abstract class EntityFactoryManager<E extends IEntity, M extends EntityManager<E, K>, F extends EntityFactory<E>, T, K> extends EntityManager<F, T> {
    entitiesManager : M;

    cancellations : Map<T, CancelToken> = new Map;    

    constructor ( entities : M, server : UnicastServer ) {
        super( server );

        this.entitiesManager = entities;

        this.server.onClose.subscribe( () => this.destroy() );
    }

    protected async scanFactory ( factory : F ) {
        const cancel = new CancelToken();
        
        this.cancellations.set( this.getEntityKey( factory ), cancel );

        try {
            for await ( let entity of factory.entities( cancel ) ) {
                if ( !cancel.cancellationRequested ) {
                    this.entitiesManager.add( entity )
                }
            }
        } catch ( error ) {
            this.server.onError.notify( error );
        }

        this.cancellations.delete( this.getEntityKey( factory ) );
    }

    add ( factory : F ) : this {
        super.add( factory );
        
        this.scanFactory( factory ).catch( error => this.server.onError.notify( error ) );

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

    destroy () {
        for( let cancel of this.cancellations.values() ) {
            cancel.cancel();
        }
    }
}