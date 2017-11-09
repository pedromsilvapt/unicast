import { CancelToken } from "./CancelToken";
import { Deferred } from './Deferred';

(Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol("Symbol.asyncIterator");

export async function * merge<T> ( iterables : AsyncIterable<T>[], cancel ?: CancelToken ) : AsyncIterable<T> {
    const iterators = iterables.map( it => it[ Symbol.asyncIterator ]() );

    const next = iterators.map( ( it, i ) => it.next().then<[IteratorResult<T>, number]>( res => [ res, i ] ) );

    let done : number = 0;

    while ( done < iterables.length && ( !cancel || !cancel.isCancelled() ) ) {
        const [ result, index ] = await Promise.race( next );

        if ( cancel && cancel.isCancelled() ) {
            return;
        }

        if ( !result.done ) {
            yield result.value;

            next[ index ] = iterators[ index ].next().then<[IteratorResult<T>, number]>( res => [ res, index ] );
        } else {
            done += 1;

            next[ index ] = new Promise( () => void 0 );
        }
    }
}

export async function * toIterable <T> ( promises : Promise<T>[] ) : AsyncIterable<T> {
    const indexed = promises.map( ( p, i ) => p.then<[T, number]>( r => [ r, i ] ) );

    let done : number = 0;

    while ( done < indexed.length ) {
        const [ result, index ] = await Promise.race( indexed.filter( x => x ) );

        indexed[ index ] = null;

        done += 1;

        yield result;
    }
}

export async function toArray<T> ( iterable : AsyncIterable<T> ) : Promise<T[]> {
    const items : T[] = [];

    for await ( let item of iterable ) {
        items.push( item );
    }

    return items;
}


export interface PushAsyncIterable<T> {
    ( value : T ) : void;
}

export interface EndAsyncIterable {
    () : void;
}

export function deferred<T> ( request ?: () => void ) : [ PushAsyncIterable<T>, EndAsyncIterable, AsyncIterableIterator<T> ] {
    let allDone : boolean = false;

    let waitingQueue : Deferred<IteratorResult<T>>[] = [];

    let buffer : T[] = [];

    const push : PushAsyncIterable<T> = ( value : T ) => {
        if ( !allDone ) {
            if ( waitingQueue.length ) {
                waitingQueue.shift().resolve( { done: false, value } );
            } else {
                buffer.push( value )
            }
        }
    };

    const done : EndAsyncIterable = () => {
        if ( !allDone ) {
            allDone = true;
            
            for ( let waiting of waitingQueue ) {
                waiting.resolve( { done: true, value: null } );
            }
        }
    };

    
    const iterable = {
        [Symbol.asyncIterator] () : AsyncIterableIterator<T> {
            return iterable;
        },

        async next () : Promise<IteratorResult<T>> {
            if ( buffer.length ) {
                return { done: false, value: buffer.shift() };
            }

            if ( allDone ) {
                return { done: true, value: null };
            }

            const waiting = new Deferred<IteratorResult<T>>();

            waitingQueue.push( waiting );

            if ( request ) {
                request();
            }

            const { done, value } = await waiting.promise;

            if ( done ) {
                return { done: true, value: null };
            }
            
            return { done: false, value: value };
        }
    }

    return [ push, done, iterable ];
}
