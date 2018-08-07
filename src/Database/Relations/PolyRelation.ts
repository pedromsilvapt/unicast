import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";

export interface PolyRelationMap<R extends Record> {
    [ type : string ] : BaseTable<R>
}

export abstract class PolyRelation<M extends Record, R extends Record, V> extends Relation<M, V> {
    typesMap : PolyRelationMap<R>;

    constructor ( member : string, typesMap : PolyRelationMap<R> ) {
        super( member );

        this.typesMap = typesMap;
    }
}
