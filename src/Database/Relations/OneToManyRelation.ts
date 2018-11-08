import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import * as sortBy from "sort-by";

export abstract class OneToManyRelation<M extends Record, R extends Record> extends Relation<M, R[]> {
    public relatedTable : BaseTable<R>;

    public member : string;

    public foreignKey : string;

    public indexName : string = null;


    protected orderByFields : string[] = null;

    constructor ( member : string, relatedTable : BaseTable<R>, foreignKey : string, indexName ?: string ) {
        super( member );

        this.relatedTable = relatedTable;
        this.foreignKey = foreignKey;
        this.indexName = indexName;
    }

    public indexBy ( indexName : string ) : this {
        this.indexName = indexName;
        
        return this;
    }

    public orderBy ( orderByFields : string | string[] ) : this {
        if ( typeof orderByFields === 'string' ) {
            orderByFields = [ orderByFields ];
        }

        this.orderByFields = orderByFields;
        
        return this;
    }
}

export class HasManyRelation<M extends Record, R extends Record> extends OneToManyRelation<M, R> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R[]>> {
        const keys = items.map( item => item.id );

        const related = await this.findAll( this.relatedTable, keys, this.runQuery.bind( this ), this.foreignKey, this.indexName );
        
        return itt( related ).groupBy( rel => rel[ this.foreignKey ] );
    }

    findRelated ( item : M, related : Map<string, R[]> ) : R[] {
        let records = ( related.get( item.id ) || [] );

        if ( this.orderByFields ) {
            records = records.sort( sortBy( ...this.orderByFields ) );
        }

        return records;
    }
}