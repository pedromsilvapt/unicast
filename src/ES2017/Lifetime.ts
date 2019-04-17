export abstract class Binding {
    protected _alive : boolean = true;

    get alive () {
        return this._alive;
    }

    protected abstract closeBinding ();

    close () : void {
        if ( !this.alive ) {
            this._alive = false;

            this.closeBinding();
        }
    }
}

export class Lifetime extends Binding {
    protected bindings : Binding[] = [];
    
    bind<T extends Binding> ( binding : T ) : T {
        this.bindings.push( binding );

        return binding;
    }

    bindEvent ( emitter : EventEmitter, event : string, listener : Function ) : EventBinding {
        if ( !this.alive ) {
            throw new Error( 'Can\'t bind to an expired lifetime.' );
        }

        const binding = new EventBinding( emitter, event, listener );

        this.bindings.push( binding );

        return binding;
    }

    protected closeBinding () {
        for ( let binding of this.bindings ) {
            try { binding.close(); } catch {}
        }

        this.bindings = null;
    }
}

export interface EventEmitter {
    on ( event : string, callback : Function );

    off ( event : string, callback : Function );
}

export class EventBinding extends Binding {
    protected emitter : EventEmitter;
    
    protected event : string;
    
    protected listener : Function;

    protected binding : Function;

    constructor ( emitter : EventEmitter, event : string, listener : Function ) {
        super();
        
        this.emitter = emitter;

        this.event = event;

        this.listener = listener;

        this.binding = ( ...args ) => this.listener( ...args );

        this.emitter.on( this.event, this.binding );
    }

    protected closeBinding () {
        this.emitter.off( this.event, this.binding );

        this.emitter = null;
        this.event = null;
        this.listener = null;
        this.binding = null;
    }
}