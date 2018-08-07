import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import * as r from 'rethinkdb';

export abstract class OneToManyRelation<M extends Record, R extends Record> extends Relation<M, R[]> {
    public relatedTable : BaseTable<R>;

    public member : string;

    public foreignKey : string;

    constructor ( member : string, relatedTable : BaseTable<R>, foreignKey : string ) {
        super( member );

        this.relatedTable = relatedTable;
        this.foreignKey = foreignKey;
    }
}

export class HasManyRelation<M extends Record, R extends Record> extends OneToManyRelation<M, R> {
    async loadRelated ( items : M[] ) : Promise<Map<string, R[]>> {
        const keys = items.map( item => item.id );

        const related = await this.relatedTable.find( query => this.runQuery( query ).filter( row => r.expr( keys ).contains( row( this.foreignKey ) as any ) ) );

        return itt( related ).groupBy( rel => rel[ this.foreignKey ] );
    }

    findRelated ( item : M, related : Map<string, R[]> ) : R[] {
        return related.get( item.id );
    }
}