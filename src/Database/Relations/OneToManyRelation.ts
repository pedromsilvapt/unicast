import { TableRecord, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import * as sortBy from "sort-by";

export abstract class OneToManyRelation<M extends TableRecord, R extends TableRecord> extends Relation<M, R[]> {
    public relatedTable : BaseTable<R>;

    public foreignKey : string;

    protected orderByFields : string[] = null;

    constructor ( member : string, relatedTable : BaseTable<R>, foreignKey : string, indexName ?: string ) {
        super( member );

        this.relatedTable = relatedTable;
        this.foreignKey = foreignKey;
    }

    public orderBy ( orderByFields : string | string[] ) : this {
        if ( typeof orderByFields === 'string' ) {
            orderByFields = [ orderByFields ];
        }

        this.orderByFields = orderByFields;
        
        return this;
    }
}

export class HasManyRelation<M extends TableRecord, R extends TableRecord> extends OneToManyRelation<M, R> {
    subRelations : Relation<R, any>[] = [];

    public with ( ...subRelations : Relation<R, any>[] ) : HasManyRelation<M, R> {
        const relation = new HasManyRelation( 
            this.member, 
            this.relatedTable, 
            this.foreignKey,
        );

        relation.subRelations = [ ...this.subRelations ];
        relation.subRelations.push( ...subRelations );

        return relation;
    }

    async loadSubRelations ( records : R[] ) {
        for ( let relation of this.subRelations ) {
            await relation.applyAll( records );
        }
    }
    
    async loadRelated ( items : M[] ) : Promise<Map<string, R[]>> {
        const keys = items.map( item => item.id );

        const related = await this.findAll( this.relatedTable, keys, this.runQuery.bind( this ), this.foreignKey );
        
        await this.loadSubRelations( related );

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
