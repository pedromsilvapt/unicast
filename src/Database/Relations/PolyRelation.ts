import { TableRecord, Relation } from "./Relation";
import { BaseTable } from "../Database";

export interface PolyRelationMap<R extends TableRecord> {
    [ type : string ] : BaseTable<R>;
}

export abstract class PolyRelation<M extends TableRecord, R extends TableRecord, V, E = {}> extends Relation<M, V, E> {
    typesMap : PolyRelationMap<R>;

    constructor ( member : string, typesMap : PolyRelationMap<R> ) {
        super( member );

        this.typesMap = typesMap;
    }
}
