import { LinkedList } from "../../ES2017/LinkedList";
import { delay } from "./HlsVideoMediaStream";
import { EventEmitter } from 'events';
import { Future } from "@pedromsilva/data-future";

export class SegmentsMap<T> extends EventEmitter {
    totalSize : number;

    segmentSize : number;

    map : T[] = [];

    protected mapSize : number = 0;

    watchers : LinkedList<SegmentWatcher<T>> = new LinkedList();

    get totalCount () : number {
        return Math.ceil( this.totalSize / this.segmentSize );
    }

    count : number = 0;

    constructor ( totalSize : number, segmentSize : number = 1 ) {
        super();

        this.totalSize = totalSize;
        this.segmentSize = segmentSize;
    }

    has ( index : number ) : boolean {
        return !!this.map[ index ];
    }

    insert ( index : number, value : T ) {
        if ( !this.map[ index ] ) {
            this.map[ index ] = value;

            this.mapSize = Math.max( this.mapSize, index + 1 );

            this.count += 1;

            this.triggerWatcher( index, value );
        }
    }

    get ( index : number ) : T {
        if ( !this.has( index ) ) {
            throw new Error( `Trying to get segment not available "${ index }"` );
        }

        return this.map[ index ];
    }

    findNextEmpty ( index : number ) : Segment {
        for ( let segment of this.empty() ) {
            if ( segment.start >= index ) {
                return segment;
            }

            if ( segment.end >= index ) {
                return { start: index, end: segment.end };
            }
        }

        return null;
    }

    * entries () : IterableIterator<[number, T]> {
        const limit = Math.max( this.totalCount === Infinity ? 0 : this.totalCount, this.mapSize );
        
        for ( let i = 0; i < limit; i++ ) {
            yield [ i, this.has( i ) ? this.get( i ) : null ];
        }
    }

    * segments () : IterableIterator<Segment> {
        let full : Segment = null;
        
        for ( let [ index, value ] of this.entries() ) {
            if ( !value ) {
                if ( full ) {
                    yield full;
                }

                full = null;
            } else {
                if ( !full ) {
                    full = { start: index, end: index };
                }

                full.end = index;
            }
        }

        if ( full ) {
            yield full;
        }
    }

    * empty () : IterableIterator<Segment> {
        let full : Segment = { start: 0, end: this.totalCount };
        
        for ( let segment of this.segments() ) {
            if ( segment.start > full.start ) {
                yield { start: full.start, end: segment.start - 1 };
            }

            full.start = segment.end + 1;
        }

        if ( full.start <= full.end ) {
            yield full;
        }
    }

    protected triggerWatcher ( index : number, value : T ) : void {
        this.watchers.filter( ( record ) => {
            if ( record.index == index ) {
                record.watcher.resolve( delay( 1000, value ) );
            }

            return !record.watcher.isResolved;
        } );
    }

    protected flushWatchers () : void {
        this.watchers.filter( ( record ) => {
            if ( this.has( record.index ) ) {
                record.watcher.resolve( this.get( record.index ) );
            }

            return !record.watcher.isResolved;
        } );
    }

    waitFor ( index : number ) : Promise<T> {
        if ( this.has( index ) ) {
            return Promise.resolve( this.get( index ) );
        }

        const watcher = new Future<T>();
        
        this.watchers.append( { index, watcher } );

        this.emit( 'queue', index );

        return watcher.promise;
    }
}

export interface SegmentWatcher<T> {
    index : number;
    watcher : Future<T>;
}

export interface Segment {
    start: number;
    end: number;
}
