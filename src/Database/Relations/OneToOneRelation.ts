import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";

export abstract class OneToOneRelation<M extends Record, R extends Record, E = {}> extends Relation<M, R, E> {
    public relatedTable : BaseTable<R>;

    public foreignKey : string;

    public indexName ?: string;

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
}

// The foreign key is stored in the related record
export class HasOneRelation<M extends Record, R extends Record> extends OneToOneRelation<M, R> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys = items.map( item => item.id );

        const related = await this.findAll( this.relatedTable, keys, this.runQuery.bind( this ), this.foreignKey, this.indexName );
        
        return itt( related ).keyBy( rel => rel.id )
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item.id );
    }
}

// The foreign key is stored in this record
export class BelongsToOneRelation<M extends Record, R extends Record, E = {}> extends OneToOneRelation<M, R, E> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys : string[] = items.map( item => item[ this.foreignKey ] );

        const related = await this.relatedTable.findAll( keys, { query: this.runQuery.bind( this ) } );

        return itt( related ).keyBy( rel => rel[ "id" ] );
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item[ this.foreignKey ] );
    }
}