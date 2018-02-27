declare module "itt" {
    function itt<T> ( iterable : Iterable<T> ) : IterableStream<T>;

    interface IterableStream<T> extends IterableIterator<T> {
        // Slicing
        /**
         * Like `Array.prototype.slice`. Returns an iterator which yields a subsequence of the elements of this iterator, starting at the startth element (inclusive) and ending at the endth element (exclusive).
         *
         * If an index is negative, that index is treated as an index from the end of the iterator. If end is missing, it is treated as if it were the number of elements in this iterator.
         * 
         * @param {number} [start] 
         * @param {number} [end] 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        slice ( start ?: number, end ?: number ) : IterableStream<T>;

        /**
         * An iterator which yields all but the first n elements of this iterator.
         * 
         * @param {number} [number] 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        drop ( number ?: number ) : IterableStream<T>;

        /**
         * An iterator which skips elements of this iterator until fn(x) returns a falsey value for an element x, then yields x and every element after it.
         * 
         * @param {( elem : T ) => boolean} fn 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        dropWhile ( fn : ( elem : T ) => boolean ) : IterableStream<T>;

        /**
         * An iterator which yields all but the last n elements of this iterator.
         * 
         * **Note:** This method caches at most n elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @param {number} n 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        dropLast ( n : number ) : IterableStream<T>;

        /**
         * An iterator which yields the first n elements of this iterator.
         * 
         * @param {number} n 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        take ( n : number ) : IterableStream<T>;

        /**
         * An iterator which yields elements of this iterator until `fn(x)` returns a falsey value for an element `x`, then stops without yielding `x`.
         * 
         * @param {( elem : T ) => boolean} fn 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        takeWhile ( fn : ( elem : T ) => boolean ) : IterableStream<T>;

        /**
         * An iterator which yields the last `n` elements of this iterator. If this iterator yields fewer than n elements, it yields all available elements.
         * 
         * **Note:** This method caches at most n elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @param {number} n 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        takeLast ( n : number ) : IterableStream<T>;

        /**
         * An iterator which yields all but the first element of this iterator.
         * 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        tail () : IterableStream<T>;

        /**
         * An iterator which yields all but the last element of this iterator.
         * 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        init () : IterableStream<T>;

        // Transforming 
        /**
         * An iterator which yields `fn(x)` for each element `x` of this iterator.
         * 
         * @template V 
         * @param {( elem : T ) => V} predicate 
         * @returns {IterableStream<V>} 
         * @memberof IterableStream
         */
        map<V> ( predicate : ( elem : T ) => V ) : IterableStream<V>;

        /**
         * An iterator which yields the elements of `fn(x)` for each element `x` of this iterator. Equivalent to `.map(fn).flatten()`.
         * 
         * @template V 
         * @param {( elem : T ) => Iterable<V>} predicate 
         * @returns {IterableStream<V>} 
         * @memberof IterableStream
         */
        flatMap<V> ( predicate : ( elem : T ) => Iterable<V> ) : IterableStream<V>;

        /**
         * An iterator which yields the elements of this iterator for which `fn` returns a truthy value.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        filter ( predicate : ( elem : T ) => boolean ) : IterableStream<T>;

        /**
         * An iterator which yields the elements of this iterator for which `fn` returns a falsey value.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        reject ( predicate : ( elem : T ) => boolean ) : IterableStream<T>;

        /**
         * Accumulates `a = fn(a, x)` for each element of this iterator, in iteration order, and yields each intermediate result. The resultant iterator always yields the same number of elements as this iterator.
         * 
         * @template V 
         * @param {V} seed 
         * @param {( seed : V, elem : T ) => V} fn 
         * @returns {IterableStream<V>} 
         * @memberof IterableStream
         */
        scan<V> ( seed : V, fn : ( seed : V, elem : T ) => V ) : IterableStream<V>;

        /**
         * Like `.scan`, but draws (and yields) the initial value of a from the first element of this iterator, accumulating `a = fn(a, x)` for each subsequent element.
         * 
         * @param {( seed : number, elem : T ) => number} fn 
         * @returns {IterableStream<number>} 
         * @memberof IterableStream
         */
        scan1 ( fn : ( seed : T, elem : T ) => T ) : IterableStream<T>;

        // Querying
        /**
         * The first element of this iterator.
         * 
         * *Alias* `.head()`
         * 
         * @returns {T} 
         * @memberof IterableStream
         */
        first () : T;

        /**
         * The first element of this iterator.
         * 
         * *Alias of* `.head()`
         * 
         * @returns {T} 
         * @memberof IterableStream
         */
        head () : T;

        /**
         * The last element of this iterator.
         * 
         * @returns {T} 
         * @memberof IterableStream
         */
        last () : T;

        /**
         * The `i`th element of this iterator
         * 
         * @param {number} i 
         * @returns {T} 
         * @memberof IterableStream
         */
        pick ( i : number ) : T;

        /**
         * The number of elements in this iterator
         * 
         * @returns {number} 
         * @memberof IterableStream
         */
        count () : number;

        /**
         * True if `predicate(elem)` returns a truthy value for every element `x` of this iterator.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {boolean} 
         * @memberof IterableStream
         */
        every ( predicate : ( elem : T ) => boolean ) : boolean;

        /**
         * True if `predicate(elem)` returns a truthy value for any element x of this iterator.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {boolean} 
         * @memberof IterableStream
         */
        some ( predicate : ( elem : T ) => boolean ) : boolean;

        /**
         * An iterator which yields each element `x` of this iterator after calling `action(elem)`. Useful for inspecting intermediate iterators with `console.log` and for running iterators through side-effectful functions.
         * 
         * @param {( elem : T ) => void} action 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        tap ( action : ( elem : T ) => void ) : IterableStream<T>;

        // Searching
        /**
         * The first element of this iterator for which `predicate` returns a truthy value, or `undefined` if none exists.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {T} 
         * @memberof IterableStream
         */
        find ( predicate : ( elem : T ) => boolean ) : T;

        /**
         * The last element of this iterator for which `predicate` returns a truthy value, or `undefined` if none exists.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {T} 
         * @memberof IterableStream
         */
        findLast ( predicate : ( elem : T ) => boolean ) : T;

        /**
         * The 0-based index of the first element of this iterator for which `predicate` returns a truthy value, or -1 if none exists.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {number} 
         * @memberof IterableStream
         */
        findIndex ( predicate : ( elem : T ) => boolean ) : number;

        /**
         * The 0-based index of the last element of this iterator for which `predicate` returns a truthy value, or -1 if none exists.
         * 
         * @param {( elem : T ) => boolean} predicate 
         * @returns {number} 
         * @memberof IterableStream
         */
        findLastIndex ( predicate : ( elem : T ) => boolean ) : number;

        /**
         * The 0-based index of the first element of this iterator which is strictly equal (`===`) to `x`, or -1 if none exists.
         * 
         * @param {T} elem 
         * @returns {number} 
         * @memberof IterableStream
         */
        indexOf ( elem : T ) : number;

        /**
         * The 0-based index of the last element of this iterator which is strictly equal (`===`) to `x`, or -1 if none exists.
         * 
         * @param {T} elem 
         * @returns {number} 
         * @memberof IterableStream
         */
        lastIndexOf ( elem : T ) : number;

        /**
         * True if any element of this iterator is strictly equal (`===`) to `x`.
         * 
         * @param {T} elem 
         * @returns {boolean} 
         * @memberof IterableStream
         */
        includes ( elem : T ) : boolean;

        // Manipulating
        /**
         * An iterator which yields pairs, each containing an index and element of this iterator.
         * 
         * @returns {IterableStream<[ number, T ]>} 
         * @memberof IterableStream
         */
        enumerate () : IterableStream<[ number, T ]>;

        /**
         * An iterator which yields `sep` between each element of this iterator.
         * 
         * @param {T} sep 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        intersperse ( sep : T ) : IterableStream<T>;

        /**
         * An iterator which yields the elements of this iterator, in order, cycled forever.
         * 
         * **Note:** This method caches all elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        cycle () : IterableStream<T>;

        /**
         * An iterator which yields the elements of this iterator, in order, cycled n times.
         * 
         * **Note:** This method caches all elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @param {number} n 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        repeat ( n : number ) : IterableStream<T>;

        /**
         * An iterator which yields elements of this iterator and skips elements which are strictly equal to any that have already appeared.
         * 
         * **Note:** This method caches all elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        unique () : IterableStream<T>;

        /**
         * An iterator which yields the elements of each element of this iterator. Each element must itself be iterable.
         * 
         * @template V 
         * @returns {IterableStream<V>} 
         * @memberof IterableStream
         */
        flatten<V> () : IterableStream<V>;

        /**
         * An iterator which yields arrays of `n` elements from this iterator, in sequence, without duplication. If there are not an even multiple of `n` elements in total, the last array is shorter.
         * 
         * @param {number} n 
         * @returns {IterableStream<T[]>} 
         * @memberof IterableStream
         */
        chunksOf ( n : number ) : IterableStream<T[]>;

        /**
         * An iterator which yields each subsequence of n elements in this iterator. If there are fewer than `n` elements, yields nothing.
         * 
         * **Note:** This method caches at most `n` elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @param {number} [n] 
         * @returns {IterableStream<T[]>} 
         * @memberof IterableStream
         */
        subsequences ( n ?: number ) : IterableStream<T[]>;

        /**
         * An iterator which yields arrays, each containing an element from this iterator and `n` elements of lookahead (or `undefined` if past the end of this iterator).
         * 
         * **Note:** This method caches at most n elements of this iterator. It does not pull elements from this iterator, however, until its return value is iterated.
         * 
         * @param {number} [n] 
         * @returns {IterableStream<T[]>} 
         * @memberof IterableStream
         */
        lookahead ( n ?: number ) : IterableStream<T[]>;

        /**
         * An iterator which yields arrays of elements at sequential indices in each element of this iterator, whose elements must be iterable. Equivalent to `zip(...this)`.
         * 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        transpose () : IterableStream<T>;

        // Combining 
        
        /**
         * An iterator which yields the elements of this iterator, followed by the elements of iter, etc.
         * 
         * @param {IterableStream<T>} iter 
         * @param {...IterableStream<T>[]} iterables 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        concat ( iter : IterableStream<T>, ...iterables : IterableStream<T>[] ) : IterableStream<T>;

        /**
         * An iterator which yields arrays containing one element from this iterator and one element from each argument iterator, stopping when any iterator is done.
         * 
         * @template T1 
         * @param {IterableStream<T1>} iterable1 
         * @returns {IterableStream<[T, T1]>} 
         * @memberof IterableStream
         */
        zip<T1> ( iterable1 : IterableStream<T1> ) : IterableStream<[T, T1]>;
        zip<T1, T2> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2> ) : IterableStream<[T, T1, T2]>;
        zip<T1, T2, T3> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2>, iterable3 : IterableStream<T3> ) : IterableStream<[T, T1, T2, T3]>;
        zip<T1, T2, T3, T4> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2>, iterable3 : IterableStream<T3>, iterable4 : IterableStream<T4> ) : IterableStream<[T, T1, T2, T4, T4]>;
        zip ( iterable : IterableStream<T>, ...iterables : IterableStream<T>[] ) : IterableStream<T[]>;

        /**
         * An iterator which yields arrays containing one element from this iterator and one element from each argument iterator, stopping when all iterators are done.
         * 
         * @template T1 
         * @param {IterableStream<T1>} iterable1 
         * @returns {IterableStream<[T, T1]>} 
         * @memberof IterableStream
         */
        parallel<T1> ( iterable1 : IterableStream<T1> ) : IterableStream<[T, T1]>;
        parallel<T1, T2> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2> ) : IterableStream<[T, T1, T2]>;
        parallel<T1, T2, T3> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2>, iterable3 : IterableStream<T3> ) : IterableStream<[T, T1, T2, T3]>;
        parallel<T1, T2, T3, T4> ( iterable1 : IterableStream<T1>, iterable2 : IterableStream<T2>, iterable3 : IterableStream<T3>, iterable4 : IterableStream<T4> ) : IterableStream<[T, T1, T2, T4, T4]>;
        parallel ( iterable : IterableStream<T>, ...iterables : IterableStream<T>[] ) : IterableStream<T[]>;

        /**
         * An iterator which yields the elements of this iterator, followed by `elems`.
         * 
         * @param {T[]} elems 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        push ( elems : T[] ) : IterableStream<T>;

        /**
         * An iterator which yields `elems`, etc., followed by the elements of this iterator.
         * 
         * @param {T[]} elems 
         * @returns {IterableStream<T>} 
         * @memberof IterableStream
         */
        unshift ( elems : T[] ) : IterableStream<T>;

        // Reducing
        /**
         * Accumulates `a = fn(a, elem)` for each element of this iterator, in iteration order.
         * 
         * @template A 
         * @param {( a : A, elem : T ) => A} fn 
         * @returns {A} 
         * @memberof IterableStream
         */
        reduce<A> ( fn : ( a : A, elem : T ) => A ) : A;

        /**
         * Calls `fn(a, elem)` for each element of this iterator, in iteration order, then returns a.
         * 
         * @template A 
         * @param {( a : A, elem : T ) => void} fn 
         * @returns {A} 
         * @memberof IterableStream
         */
        inject<A> ( fn : ( a : A, elem : T ) => void ) : A;

        /**
         * The sum of the elements of this iterator.
         * 
         * @returns {number} 
         * @memberof IterableStream
         */
        sum () : number;

        /**
         * The product of the elements of this iterator.
         * 
         * @returns {number} 
         * @memberof IterableStream
         */
        product () : number;

        /**
         * The maximum element of this iterator.
         * 
         * @returns {number} 
         * @memberof IterableStream
         */
        min () : number;

        /**
         * The minimum element of this iterator.
         * 
         * @returns {number} 
         * @memberof IterableStream
         */
        max () : number;

        /**
         * The minimum and maximum elements of this iterator as a pair `[min, max]`.
         * 
         * @returns {[ number, number ]} 
         * @memberof IterableStream
         */
        minMax () : [ number, number ];

        /**
         * Stringifies and concatenates all values, separated by `sep`, like `Array.prototype.join`.
         * 
         * @param {string} [sep] 
         * @returns {string} 
         * @memberof IterableStream
         */
        join ( sep ?: string ) : string;

        /**
         * Calls `fn(elem)` for each element of this iterator and returns a map from return values of `fn` to arrays of elements. If `unique` (default false) is true, use sets instead of arrays. (If `fn` is a pure function, this is equivalent to `.unique().groupBy(fn))`
         * 
         * @template K 
         * @param {( elem : T ) => K} fn 
         * @param {true} unique 
         * @returns {Map<K, Set<T>>} 
         * @memberof IterableStream
         */
        groupBy<K> ( fn : ( elem : T ) => K, unique : true ) : Map<K, Set<T>>
        groupBy<K> ( fn : ( elem : T ) => K, unique : false ) : Map<K, T[]>
        groupBy<K> ( fn : ( elem : T ) => K ) : Map<K, T[]>

        /**
         * Calls `fn(elem)` for each element of this iterator and returns a map from return values of `fn` to elements. Later elements overwrite earlier elements in the map.
         * 
         * @template K 
         * @param {( elem : T ) => K} fn 
         * @returns {Map<K, T>} 
         * @memberof IterableStream
         */
        keyBy<K> ( fn : ( elem : T ) => K ) : Map<K, T>;

        /**
         * Calls `fn(elem)` for each element of this iterator, in iteration order. Ergonomically nicer than a `for (…) {…}` loop after a sequence of method calls or when not passing a function literal as an argument. Equivalent to `.tap(fn).drain()`.
         * 
         * @param {( elem : T ) => void} fn 
         * @memberof IterableStream
         */
        forEach ( fn : ( elem : T ) => void ) : void;

        /**
         * Consumes all elements of this iterator and returns nothing (`undefined`). Useful for iterators with side effects. Equivalent to `.forEach(() => {})`.
         * 
         * @memberof IterableStream
         */
        drain () : void;

        // Conversion
        /**
         * An array of the elements in this iterator. Equivalent to `Array.from(this)`.
         * 
         * *Alias* `.array()`
         * 
         * @returns {T[]} 
         * @memberof IterableStream
         */
        toArray () : T[];

        /**
         * An array of the elements in this iterator. Equivalent to `Array.from(this)`.
         * 
         * *Alias of* `.toArray()`
         * 
         * @returns {T[]} 
         * @memberof IterableStream
         */
        array () : T[];

        /**
         * A Set of the elements in this iterator. Equivalent to `new Set(this)`.
         * 
         * @returns {Set<T>} 
         * @memberof IterableStream
         */
        toSet () : Set<T>;

        /**
         * A Map of the key-value pairs in this iterator. Equivalent to `new Map(this)`.
         * 
         * @template K 
         * @template V 
         * @returns {Map<K, V>} 
         * @memberof IterableStream
         */
        toMap<K, V> () : Map<K, V>;

        /**
         * An object containing the key-value pairs in this iterator. If `empty` is true, starts with `Object.create(null)` instead of `{}`.
         * 
         * @template V 
         * @param {boolean} [empty] 
         * @returns {{ [key : string ] : V }} 
         * @memberof IterableStream
         */
        toObject<V> ( empty ?: boolean ) : { [key : string ] : V };

        // Forking
        /**
         * An array of `n` iterators which all yield every element of this iterator in sequence.
         * 
         * **Note:** This method caches some elements of this iterator. As any derived iterator advances, new elements are cached, and once every derived iterator has advanced past an element, that element is discarded.
         * 
         * @param {1} n 
         * @returns {[ IterableStream<T>]} 
         * @memberof IterableStream
         */
        fork ( n : 1 ) : [ IterableStream<T>];
        fork ( n : 2 ) : [ IterableStream<T>, IterableStream<T> ];
        fork ( n : 3 ) : [ IterableStream<T>, IterableStream<T>, IterableStream<T> ];
        fork ( n : 4 ) : [ IterableStream<T>, IterableStream<T>, IterableStream<T>, IterableStream<T> ];
        fork ( n : 5 ) : [ IterableStream<T>, IterableStream<T>, IterableStream<T>, IterableStream<T>, IterableStream<T> ];
        fork ( n : number ) : IterableStream<T>[];
    }

    namespace itt {
        /**
         * Wraps an iterator. The wrapper is also iterable, and supports the methods listed below. All functions and methods which return iterators automatically wrap them.
         * 
         * @export
         * @template T 
         * @param {IterableIterator<T>} xs 
         * @returns {IterableStream<T>} 
         */
        export function from<T> ( xs : IterableIterator<T> ) : IterableStream<T>;

        /**
         * An iterator which yields no values.
         * 
         * @export
         * @template T 
         * @returns {IterableStream<T>} 
         */
        export function empty<T> () : IterableStream<T>;

        /**
         * An iterator over an integer range from 0 (inclusive) to `end` (exclusive), incrementing by 1.
         * 
         * @export
         * @param {number} end 
         * @returns {IterableStream<number>} 
         */
        export function range ( end : number ) : IterableStream<number>;

        /**
         * An iterator over an integer range from `start` (inclusive) to `end` (exclusive), incrementing or decrementing by `skip`.
         * 
         * @export
         * @param {number} start 
         * @param {number} end 
         * @param {number} [skip] 
         * @returns {IterableStream<number>} 
         */
        export function range ( start : number, end : number, skip ?: number ) : IterableStream<number>;

        /**
         * An iterator over the integers starting at `start` and incrementing or decrementing by `skip`. Best paired with `.take()` or its variants.
         * 
         * @export
         * @param {number} [start] 
         * @param {number} [skip] 
         * @returns {IterableStream<number>} 
         */
        export function irange ( start ?: number, skip ?: number ) : IterableStream<number>;

        /**
         * An iterator which yields `x` `n` times.
         * 
         * @export
         * @template T 
         * @param {number} n 
         * @param {T} x 
         * @returns {IterableStream<T>} 
         */
        export function replicate <T> ( n : number, x : T ) : IterableStream<T>;

        /**
         * An iterator which yields `x` forever.
         * 
         * @export
         * @template T 
         * @param {T} x 
         * @returns {IterableStream<T>} 
         */
        export function forever <T> ( x : T )  : IterableStream<T>;

        /**
         * An iterator which yields `x`, `fn(x)`, `fn(fn(x))`, etc.
         * 
         * @export
         * @template T 
         * @param {T} x 
         * @param {( x : T ) => T} fn 
         * @returns {IterableStream<T>} 
         */
        export function iterate <T> ( x : T, fn : ( x : T ) => T ) : IterableStream<T>;

        /**
         * An iterator over the keys and values of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : string ] : T }} obj 
         * @returns {IterableStream<[string, T]>} 
         */
        export function entries <T> ( obj : { [ key : string ] : T } ) : IterableStream<[string, T]>;

        /**
         * An iterator over the keys and values of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : number ] : T }} obj 
         * @returns {IterableStream<[number, T]>} 
         */
        export function entries <T> ( obj : { [ key : number ] : T } ) : IterableStream<[number, T]>;

        /**
         * An iterator over the keys of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : string ] : T }} obj 
         * @returns {IterableStream<string>} 
         */
        export function keys <T> ( obj : { [ key : string ] : T } ) : IterableStream<string>;

        /**
         * An iterator over the keys of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : number ] : T }} obj 
         * @returns {IterableStream<number>} 
         */
        export function keys <T> ( obj : { [ key : number ] : T } ) : IterableStream<number>;

        /**
         * An iterator over the values of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : number ] : T }} obj 
         * @returns {IterableStream<T>} 
         */
        export function values <T> ( obj : { [ key : number ] : T } ) : IterableStream<T>;

        /**
         * An iterator over the values of an object.
         * 
         * @export
         * @template T 
         * @param {{ [ key : string ] : T }} obj 
         * @returns {IterableStream<T>} 
         */
        export function values <T> ( obj : { [ key : string ] : T } ) : IterableStream<T>;

        /**
         * True if `thing` is iterable or an iterator.
         * 
         * @export
         * @template T 
         * @param {*} thing 
         * @returns {thing is IterableIterator<T>} 
         */
        export function is <T = any> ( thing : any ) : thing is IterableIterator<T>;

        /**
         * Takes a generator function and returns a generator function which returns wrapped iterators.
         * 
         * @export
         * @template T 
         * @param {( ...any : any[] ) =>IterableIterator<T>} generator 
         * @returns {( ...any : any[] ) => IterableStream<T>} 
         */
        export function generator <T> ( generator : ( ...any : any[] ) =>IterableIterator<T> ) : ( ...any : any[] ) => IterableStream<T>;
    }

    export = itt;
}