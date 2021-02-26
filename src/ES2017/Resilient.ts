export class CircuitBreaker<R, A extends any[]> {
    options : CircuitBreakerOptions<R>;

    constructor ( options : CircuitBreakerOptions<R, A> ) {
        this.options = options;
    }

    protected sleep ( time : number ) {
        return new Promise<void>( resolve => setTimeout( resolve, time ) );
    }

    protected calculateDelay ( attempt : number, lastResult ?: R ) : number {
        if ( typeof this.options.delay === 'number' ) {
            return this.options.delay;
        } else if ( typeof this.options.delay === 'function' ) {
            return this.options.delay( attempt, lastResult );
        } else {
            return 0;
        }
    }

    protected executeAction ( attempt: number, lastError: any, args: A ) : Promise<R> {
        if ( this.options.thisArg != void 0 ) {
            return Promise.resolve( this.options.action.call( this.options.thisArg, attempt, lastError, ...args ) );
        } else  {
            return Promise.resolve( this.options.action.call( this, attempt, lastError, ...args ) );
        }
    }

    public async run ( ...args: A ) : Promise<R> {
        if ( typeof this.options.maxAttempts === 'number' && this.options.maxAttempts == 0) {
            throw new Error( `No attempts were made.` );
        }

        let attempts : number = 0;
        
        if ( this.options.delayFirst ) {
            await this.sleep( this.calculateDelay( attempts ) );
        }

        let lastError: any;
        let lastPromise: Promise<R>;

        while ( true ) {
            try {
                lastPromise = this.executeAction( attempts, lastError, args );

                await lastPromise;

                break;
            } catch ( err ) {
                lastError = err;

                attempts += 1;

                if ( typeof this.options.maxAttempts === 'number' && attempts >= this.options.maxAttempts ) {
                    break;
                }

                await this.sleep( this.calculateDelay( attempts ) );
            }
        }

        return lastPromise;
    }
}

export interface CircuitBreakerOptions<T = any, A extends any[] = any[], This = CircuitBreaker<T, A>> {
    action: (this: This, attempt : number, ...args : A ) => Promise<T> | T;

    thisArg?: This;

    delay?: number | ( ( attempt : number, lastError ?: any ) => number );

    delayFirst?: boolean;

    maxAttempts ?: number;
}
