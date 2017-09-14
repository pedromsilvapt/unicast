import { CancelToken } from "./CancelToken";

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