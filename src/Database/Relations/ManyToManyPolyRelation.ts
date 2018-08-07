import { Record } from "./Relation";
import { PolyRelationMap, PolyRelation } from "./PolyRelation";
import * as itt from 'itt';
import { BaseTable } from "../Database";
import * as r from 'rethinkdb';

export interface ManyToManyPolyCache<R extends Record> {
    links : Map<string, any[]>;
    related : Map<string, Map<string, R>>;
}
export class ManyToManyPolyRelation<M extends Record, R extends Record> extends PolyRelation<M, R, R[]> {
    foreignType : string;

    foreignKey : string;

    middleTable : string | BaseTable<any>;

    middleKey : string;

    constructor ( member : string, typesMap : PolyRelationMap<R>, middleTable : string | BaseTable<any>, middleKey : string, foreignType : string, foreignKey : string ) {
        super( member, typesMap );

        this.middleTable = middleTable;
        this.middleKey = middleKey;

        this.foreignType = foreignType;
        this.foreignKey = foreignKey;
    }

    async loadRelatedLinks ( items : M[] ) : Promise<any[]> {
        const keys = items.map( item => item.id );

        
        const middleTable = this.middleTable;
        
        if ( typeof middleTable === 'string' ) {
            const links = [];
            
            for ( let item of items ) {
                for ( let link of item[ middleTable ] ) {
                    links.push( { [ this.middleKey ]: item.id, [ this.foreignKey ]: link[ this.foreignKey ], [ this.foreignType ]: link[ this.foreignType ] } );
                }
            }

            return links;
        } else {
            return middleTable.find( query => query.filter( row => ( r as any ).expr( keys ).contains( row( this.middleKey ) as any ) ) );
        }
    }

    buildRelatedCache ( middleTableItems : any[], related : Map<string, Map<string, R>> ) : ManyToManyPolyCache<R> {
        const links = itt( middleTableItems ).groupBy( item => item[ this.middleKey ] as string );
        
        return { links, related: related };
    }

    async loadRelated ( items : M[] ) : Promise<ManyToManyPolyCache<R>> {
        const middleTableItems = await this.loadRelatedLinks( items );

        const groupedKeys = itt( middleTableItems ).groupBy( item => item[ this.foreignType ] );

        const groupedRelated = new Map();

        for ( let [ type, keys ] of groupedKeys ) {
            const table = this.typesMap[ type ];

            if ( !table ) {
                console.log( `Ignoring missing type "${ type }" in polymorphic relation.` );

                continue;
            }

            const middleKeys = keys.map( item => item[ this.foreignKey ] );
    
            const related = await table.findAll( middleKeys, {
                query: this.runQuery.bind( this )
            } );
            
            groupedRelated.set( type, itt( related ).keyBy( rel => rel.id ) );
        }

        return this.buildRelatedCache( middleTableItems, groupedRelated );
    }

    findRelated ( item : M, cache : ManyToManyPolyCache<R> ) : R[] {
        const links = cache.links.get( item.id );

        if ( links ) {
            return links.map( link => {
                const type = link[ this.foreignType ];
                
                const relatedEntries = cache.related.get( type );
        
                if ( relatedEntries ) {
                    const key = link[ this.foreignKey ];
        
                    return relatedEntries.get( key );
                }
            } );
        }

        return [];
    }
}
