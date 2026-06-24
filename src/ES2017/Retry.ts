
export function delay ( milliseconds : number ) {
    return new Promise<void>( resolve => setTimeout( resolve, milliseconds ) );
}

export async function retry<T> ( fn : () => Promise<T> | T, base : number = 200, timeout : number = 60000, maxDelay : number = 0, multiplier = 4, additive = 0 ) : Promise<T> {
    const start = Date.now();

    while ( true ) {
        try {
            return await fn();
        } catch ( err ) {
            base *= multiplier;
            base += additive;

            if ( maxDelay > 0 && base > maxDelay ) {
                base = maxDelay;
            }

            const now = Date.now();

            if ( timeout > 0 && now + base > start + timeout ) {
                base = start + timeout - now;

                if ( base <= 0 ) {
                    return Promise.reject( err );
                }

                break;
            }

            await delay( base );
        }
    }

    if ( base > 0 ) {
        await delay( base );

        return fn();
    }
}
