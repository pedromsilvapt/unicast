import { NotImplementedError } from 'restify-errors';
import { Knex } from 'knex';
import type { BaseTable } from '../Database';
import type { Relatable } from '../RelationGraph';

export interface TableRecord { id ?: string; }

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

export abstract class Relation<M extends TableRecord, R, E = {}> {
    member : string;

    queryClauses ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder;

    abstract relatedTable: Relatable<any>;

    constructor ( member : string ) {
        this.member = member;
    }
    
    with ( ...subRelations: Relation<any, any>[] ) : Relation<M, R, E> {
        throw new NotImplementedError();
    }

    where ( query : ( query : Knex.QueryBuilder ) => Knex.QueryBuilder ) : this {
        this.queryClauses = query;
        
        return this;
    }

    runQuery ( query : Knex.QueryBuilder ) {
        if ( this.queryClauses ) {
            return this.queryClauses( query );
        }

        return query;
    }

    protected findAll<T> ( table : BaseTable<T>, keys : string[], customQuery : ( query : Knex.QueryBuilder ) => Knex.QueryBuilder, fieldName : string ) : Promise<T[]> {
        return table.findAll( keys, { column: fieldName, query: customQuery } );
    }

    abstract loadRelated ( items : M[] ) : Promise<any>;

    abstract findRelated ( item : M, related : any ) : any;

    async load ( record : M ) : Promise<R> {
        return ( await this.loadAll( [ record ] ) )[ 0 ];
    }

    async loadAll ( items : M[] ) : Promise<R[]> {
        let itemsToLoad = items;
        
        if ( itemsToLoad.some( model => !model.id ) ) {
            itemsToLoad = itemsToLoad.filter( model => !!model.id );
        }

        const related = await this.loadRelated( itemsToLoad );

        const results : R[] = [];

        for ( let item of items ) {
            results.push( this.findRelated( item, related ) );
        }

        return results;
    }

    async apply<ME extends M = M> ( record : ME ) : Promise<ME & E> {
        return ( await this.applyAll( [ record ] ) )[ 0 ];
    }

    async applyAll<ME extends M = M> ( items : ME[] ) : Promise<(ME & E)[]> {
        if ( items.some( model => !model.id ) ) {
            items = items.filter( model => !!model.id );
        }

        const related = await this.loadRelated( items );

        for ( let item of items ) {
            item[ this.member ] = this.findRelated( item, related );
        }

        return items as (ME & E)[];
    }

    typed<ME extends M = M> ( items : ME[] ) : asserts items is (ME & E)[] {
        // nop
    }
}
