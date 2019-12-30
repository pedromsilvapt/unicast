import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";

export interface PolyRelationMap<R extends Record> {
    [ type : string ] : BaseTable<R>
}

export abstract class PolyRelation<M extends Record, R extends Record, V, E = {}> extends Relation<M, V, E> {
    typesMap : PolyRelationMap<R>;

    constructor ( member : string, typesMap : PolyRelationMap<R> ) {
        super( member );

        this.typesMap = typesMap;
    }
}
