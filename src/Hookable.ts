// import { Semaphore } from "await-semaphore";
import { Semaphore } from "data-semaphore";

export class Hookable {
    hooks : Map<string, Hook> = new Map();

    allowImplicitCreation : boolean = true;

    has ( name : string ) {
        return this.hooks.has( name );
    }

    create<T = any> ( name : string ) : Hook<T> {
        if ( this.has( name ) ) {
            throw new Error( `Hook "${ name }" already defined.` );
        }

        const hook = new Hook( name );

        this.hooks.set( name, hook );

        return hook;
    }

    get ( name : string ) {
        if ( this.hooks.has( name ) ) {
            if ( this.allowImplicitCreation ) {
                return this.create( name );
            } else {
                throw new Error( `Hook "${ name }" not found.` );
            }
        }

        return this.hooks.get( name );
    }

    subscribe<T = any> ( name : string, subscription : HookSubscription<T> ) : HookSubscriptionCancellation {
        return this.get( name ).subscribe( subscription );
    }

    unsubscribe<T = any> ( name : string, subscription : HookSubscription<T> ) {
        this.get( name ).unsubscribe( subscription );
    }

    notify<T = any> ( name : string, arg ?: T ) : Promise<void> {
        return this.get( name ).notify( arg );
    }
}

export interface HookSubscription<T> {
    ( arg : T ) : void | Promise<void>;
}

export interface HookSubscriptionCancellation {
    () : void;
}

export class Hook<T = any> {
    name : string;

    protected subscriptions : HookSubscription<T>[] = [];

    protected notificationSemaphore : Semaphore = new Semaphore( 1 );

    allowConcurrentNotifications : boolean = false;

    constructor ( name : string ) {
        this.name = name;
    }

    setSequential () : this {
        this.allowConcurrentNotifications = false;
        
        return this;
    }

    setParallel () : this {
        this.allowConcurrentNotifications = true;
        
        return this;
    }

    subscribe ( callback : HookSubscription<T> ) : HookSubscriptionCancellation {
        this.subscriptions.push( callback );

        return () => {
            this.unsubscribe( callback );
        };
    }

    unsubscribe ( callback : HookSubscription<T> ) {
        this.subscriptions = this.subscriptions.filter( sub => sub == callback );
    }

    async notify ( arg ?: T ) : Promise<void> {
        let release = null;

        if ( !this.allowConcurrentNotifications ) {
            release = await this.notificationSemaphore.acquire();
        }

        for ( let subscription of this.subscriptions ) {
            try {
                await subscription( arg );
            } catch ( error ) {
                console.error( error );
            }
        }

        if ( release ) {
            release();
        }
    }
}