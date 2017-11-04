export function Singleton<T> ( keyer : ( ...args : any[] ) => T ) {
    return ( target : Object, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        const original : Function = descriptor.value;

        const memory : Map<T, Promise<any>> = new Map();

        descriptor.value = async function ( ...args : any[] ) {
            const key = keyer.apply( this, args );

            if ( memory.has( key ) ) {
                return memory.get( key );
            }

            const promise = original.apply( this, args );

            memory.set( key, promise );

            const result = await promise;

            memory.delete( key );
            
            return result;
        };

        return descriptor;
    };
}