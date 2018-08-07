import { Record, PropertyAccessor, createPropertyAccessor } from "./Relation";
import { PolyRelationMap, PolyRelation } from "./PolyRelation";
import * as itt from 'itt';

export class BelongsToOnePolyRelation<M extends Record, R extends Record> extends PolyRelation<M, R, R> {
    typesMap : PolyRelationMap<R>;

    foreignType : PropertyAccessor<M, string>;

    foreignKey : PropertyAccessor<M, string>;

    constructor ( member : string, typesMap : PolyRelationMap<R>, foreignType : string | PropertyAccessor<M, string>, foreignKey : string | PropertyAccessor<M, string> ) {
        super( member, typesMap );

        this.foreignType = createPropertyAccessor( foreignType );
        this.foreignKey = createPropertyAccessor( foreignKey );
    }

    async loadRelated ( items : M[] ) : Promise<Map<string, Map<string, R>>> {
        const groupedKeys = itt( items ).map( item => ( {
            type: this.foreignType( item ),
            key: this.foreignKey( item )
        } ) ).groupBy( item => item.type );

        const groupedRelated = new Map();

        for ( let [ type, keys ] of groupedKeys ) {
            const table = this.typesMap[ type ];

            if ( !table ) {
                console.log( `Ignoring missing type "${ type }" in polymorphic relation.` );

                continue;
            }

            const related = await table.findAll( keys.map( item => item.key ), {
                query: this.runQuery.bind( this )
            } );

            groupedRelated.set( type, itt( related ).keyBy( rel => rel.id ) );
        }

        return groupedRelated;
    }

    findRelated ( item : M, related : Map<string, Map<string, R>> ) : R {
        const type = this.foreignType( item );
        
        const relatedEntries = related.get( type );

        if ( relatedEntries ) {
            const key = this.foreignKey( item );

            return relatedEntries.get( key );
        }
    }
}
