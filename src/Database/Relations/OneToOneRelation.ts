import { TableRecord, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";

export abstract class OneToOneRelation<M extends TableRecord, R extends TableRecord, E = {}> extends Relation<M, R, E> {
    public relatedTable : BaseTable<R>;

    public foreignKey : string;

    constructor ( member : string, relatedTable : BaseTable<R>, foreignKey : string ) {
        super( member );

        this.relatedTable = relatedTable;
        this.foreignKey = foreignKey;
    }
}

// The foreign key is stored in the related record
export class HasOneRelation<M extends TableRecord, R extends TableRecord, E = {}> extends OneToOneRelation<M, R, E> {
    subRelations : Relation<R, any>[] = [];

    public with ( ...subRelations : Relation<R, any>[] ) : HasOneRelation<M, R, E> {
        const relation = new HasOneRelation<M, R, E>(
            this.member,
            this.relatedTable,
            this.foreignKey
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

        const related = await this.findAll( this.relatedTable, keys, this.runQuery.bind( this ), this.foreignKey );

        await this.loadSubRelations( related );

        return itt( related ).keyBy( rel => rel[ this.foreignKey ] )
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
            this.foreignKey
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
