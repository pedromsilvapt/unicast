import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import * as r from 'rethinkdb';

export abstract class OneToOneRelation<M extends Record, R extends Record> extends Relation<M, R> {
    public relatedTable : BaseTable<R>;

    public foreignKey : string;

    constructor ( member : string, relatedTable : BaseTable<R>, foreignKey : string ) {
        super( member );
        
        this.relatedTable = relatedTable;
        this.foreignKey = foreignKey;
    }
}

// The foreign key is stored in the related record
export class HasOneRelation<M extends Record, R extends Record> extends OneToOneRelation<M, R> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys = items.map( item => item.id );

        const related = await this.relatedTable.find( query => this.runQuery( query.filter( row => r.expr( keys ).contains( row( this.foreignKey ) as any ) ) ) );

        return itt( related ).keyBy( rel => rel.id )
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item.id );
    }
}

// The foreign key is stored in this record
export class BelongsToOneRelation<M extends Record, R extends Record> extends OneToOneRelation<M, R> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys : string[] = items.map( item => item[ this.foreignKey ] );

        const related = await this.relatedTable.findAll( keys, { query: this.runQuery.bind( this ) } );

        return itt( related ).keyBy( rel => rel[ this.foreignKey ] );
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item[ this.foreignKey ] );
    }
}