import { TableRecord, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";

export abstract class OneToOneRelation<M extends TableRecord, R extends TableRecord, E = {}> extends Relation<M, R, E> {
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
export class HasOneRelation<M extends TableRecord, R extends TableRecord> extends OneToOneRelation<M, R> {
    subRelations : Relation<R, any>[] = [];

    public with ( ...subRelations : Relation<R, any>[] ) : HasOneRelation<M, R> {
        const relation = new HasOneRelation<M, R>( 
            this.member, 
            this.relatedTable, 
            this.foreignKey, 
            this.indexName 
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
    
    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys = items.map( item => item.id );

        const related = await this.findAll( this.relatedTable, keys, this.runQuery.bind( this ), this.foreignKey, this.indexName );
        
        await this.loadSubRelations( related );

        return itt( related ).keyBy( rel => rel.id )
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item.id );
    }
}

// The foreign key is stored in this record
export class BelongsToOneRelation<M extends TableRecord, R extends TableRecord, E = {}> extends OneToOneRelation<M, R, E> {
    subRelations : Relation<R, any>[] = [];

    public with ( ...subRelations : Relation<R, any>[] ) : BelongsToOneRelation<M, R> {
        const relation = new BelongsToOneRelation<M, R, E>( 
            this.member, 
            this.relatedTable, 
            this.foreignKey, 
            this.indexName 
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

    async loadRelated ( items : M[] ) : Promise<Map<string, R>> {
        const keys : string[] = items.map( item => item[ this.foreignKey ] );

        const related = await this.relatedTable.findAll( keys, { query: this.runQuery.bind( this ) } );

        await this.loadSubRelations( related );

        return itt( related ).keyBy( rel => rel[ "id" ] );
    }

    findRelated ( item : M, related : Map<string, R> ) : R {
        return related.get( item[ this.foreignKey ] );
    }
}