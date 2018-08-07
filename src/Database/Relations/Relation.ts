import * as r from 'rethinkdb';

export interface Record { id ?: string; }

export interface PropertyAccessor<O = any, V = any> {
    ( obj : O ) : V
}

export function createPropertyAccessor<O = any, V = any> ( property : string | PropertyAccessor<O, V> ) : PropertyAccessor<O, V> {
    if ( typeof property === 'string' ) {
        const properties = property.split( '.' );

        if ( properties.length == 1 ) {
            return ( obj ) => obj[ property ];
        }

        return ( obj ) => {
            for ( let i = 0; obj && i < properties.length; i++ ) {
                obj = obj[ properties[ i ] ];
            }

            return obj as any;
        }
    } else {
        return property;
    }
}

export abstract class Relation<M extends Record, R> {
    member : string;

    queryClauses ?: ( query : r.Sequence ) => r.Sequence

    constructor ( member : string ) {
        this.member = member;
    }

    where ( query : ( query : r.Sequence ) => r.Sequence ) : this {
        this.queryClauses = query;
        
        return this;
    }

    runQuery ( query : r.Sequence ) {
        if ( this.queryClauses ) {
            return this.queryClauses( query );
        }

        return query;
    }

    abstract loadRelated ( items : M[] ) : Promise<any>;

    abstract findRelated ( item : M, related : any ) : any;

    async load ( record : M ) : Promise<R> {
        return ( await this.loadAll( [ record ] ) )[ 0 ];
    }

    async loadAll ( items : M[] ) : Promise<R[]> {
        const related = await this.loadRelated( items );

        const results : R[] = [];

        for ( let item of items ) {
            results.push( this.findRelated( item, related ) );
        }

        return results;
    }

    async apply ( record : M ) : Promise<M> {
        return ( await this.applyAll( [ record ] ) )[ 0 ];
    }

    async applyAll ( items : M[] ) : Promise<M[]> {
        const related = await this.loadRelated( items );

        for ( let item of items ) {
            item[ this.member ] = this.findRelated( item, related );
        }

        return items;
    }
}
