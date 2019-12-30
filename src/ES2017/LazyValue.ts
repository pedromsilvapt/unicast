export class LazyValue<T> {
    protected factory : () => Promise<T> | T;
    protected onClear : () => any;
    protected hasValue : boolean;
    protected value : Promise<T>;
    
    constructor ( factory : () => Promise<T> | T, onClear : () => any = null ) {
        this.factory = factory;
        this.onClear = onClear;
        this.hasValue = false;
        this.value = null;
    }

    get () : Promise<T> {
        if ( !this.hasValue ) {
            this.hasValue = true;

            this.value = Promise.resolve( this.factory() );
        }

        return this.value;
    }

    clear () {
        this.hasValue = false;
        this.value = null;

        if ( this.onClear ) this.onClear();
    }

    map<U> ( mapper : ( value : T ) => U | Promise<U> ) : LazyValue<U> {
        return new LazyValue( async () => {
            return mapper( await this.get() );
        }, () => this.clear() );
    }

    catch<U = T> ( handler : ( error : any ) => U | Promise<U> ) : LazyValue<U | T> {
        return new LazyValue<U | T>( () => this.get().catch( handler ), () => this.clear() );
    }
}