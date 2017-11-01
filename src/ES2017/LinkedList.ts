export class LinkedList<T> {
    head : LinkedListLink<T>;

    tail : LinkedListLink<T>;

    prepend ( value : T ) : this {
        this.head = new LinkedListLink( value, this.head );

        if ( !this.tail ) {
            this.tail = this.head;
        }

        return this;
    }

    append ( value : T ) : this {
        if ( !this.tail ) {
            this.head = this.tail = new LinkedListLink<T>( value );
        } else {
            this.tail.next = new LinkedListLink( value );

            this.tail = this.tail.next;
        }

        return this;
    }

    remove ( link : LinkedListLink<T>, prev ?: LinkedListLink<T> ) : this {
        if ( this.head === link ) {
            this.head = link.next;
        }

        if ( this.tail === link ) {
            this.tail = prev;
        }

        if ( prev ) {
            prev.next = link.next;
        }
    }

    * values () : IterableIterator<T> {
        let cursor = this.head;

        while ( cursor ) {
            yield cursor.value;

            cursor = cursor.next;
        }
    }

    * entries () : IterableIterator<LinkedListLink<T>> {
        let cursor = this.head;

        while ( cursor ) {
            yield cursor;

            cursor = cursor.next;
        }
    }

    filter ( predicate : ( value : T ) => boolean ) : this {
        let previous : LinkedListLink<T> = null;

        let cursor = this.head;
        
        while ( cursor ) {
            if ( !predicate( cursor.value ) ) {
                this.remove( cursor, previous );
            } else {
                previous = cursor;
            }

            cursor = cursor.next;
        }

        return this;
    }

    find ( predicate : ( value : T ) => boolean ) : LinkedListLink<T> {
        for ( let link of this.entries() ) {
            if ( predicate( link.value ) ) {
                return link;
            }
        }

        return null;
    }

    [ Symbol.iterator ] () : IterableIterator<T> {
        return this.values();
    }
}

export class LinkedListLink<T> {
    value : T;

    next : LinkedListLink<T>;

    constructor ( value : T, next : LinkedListLink<T> = null ) {
        this.value = value;

        this.next = next;
    }
}
