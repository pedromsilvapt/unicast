import { TableRecord } from "./Relation";
import { PolyRelationMap, PolyRelation } from "./PolyRelation";
import { BaseTable } from "../Database";
import { Relatable } from '../RelationGraph';
import * as itt from 'itt';
import * as sortBy from 'sort-by';

export interface ManyToManyPolyCache<R extends TableRecord> {
    links : Map<string, any[]>;
    related : Map<string, Map<string, R>>;
}
export class ManyToManyPolyRelation<M extends TableRecord, R extends TableRecord> extends PolyRelation<M, R, R[]> {
    foreignType : string;

    foreignKey : string;
    
    middleTable : BaseTable<any>;

    middleKey : string;
    
    primaryType : string;
    
    primaryKey : string;
  
    orderByFields : string[] = null;
    
    orderByLevel : "pivot" | "foreign" = "pivot";

    public pivotField : string = null;

    // TODO Support deep relations inside poly relationships
    relatedTable: Relatable<any> = null;

    constructor ( member : string, typesMap : PolyRelationMap<R>, middleTable : BaseTable<any>, middleKey : string, foreignType : string, foreignKey : string, primaryType : string = 'kind', primaryKey : string = 'id' ) {
        super( member, typesMap );

        this.middleTable = middleTable;
        this.middleKey = middleKey;

        this.foreignType = foreignType;
        this.foreignKey = foreignKey;
        
        this.primaryType = primaryType;
        this.primaryKey = primaryKey;
    }

    public savePivot ( pivotField : string ) : this {
        this.pivotField = pivotField;
        
        return this;
    }
    
    public orderBy ( orderByFields : string | string[], level : "pivot" | "foreign" = "pivot") : this {
        if ( typeof orderByFields === 'string' ) {
            orderByFields = [ orderByFields ];
        }

        this.orderByFields = orderByFields;
        this.orderByLevel = level;
        
        return this;
    }
    
    async loadRelatedLinks ( items : M[] ) : Promise<any[]> {
        const keys = items.map( item => item.id );

        const middleTable = this.middleTable;
        
        return middleTable.find( query => query.whereIn( this.middleKey, keys ) );
    }

    buildRelatedCache ( middleTableItems : any[], related : Map<string, Map<string, R>> ) : ManyToManyPolyCache<R> {
        const links : Map<string, any[]> = itt( middleTableItems ).groupBy( item => item[ this.middleKey ] as string );
        
        if ( this.orderByFields?.length > 0 && this.orderByLevel === 'pivot' ) {
            for ( const arr of links.values() ) {
                arr.sort( sortBy( ...this.orderByFields ) );
            }
        }
        
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
                column: this.primaryKey,
                query: this.runQuery.bind( this )
            } );
            
            groupedRelated.set( type, itt( related ).keyBy( rel => rel[ this.primaryKey ] ) );
        }

        return this.buildRelatedCache( middleTableItems, groupedRelated );
    }

    findRelated ( item : M, cache : ManyToManyPolyCache<R> ) : R[] {
        const links = cache.links.get( item[ this.primaryKey ] );

        if ( links ) {
            const related = links.map( link => {
                const type = link[ this.foreignType ];
                
                const relatedEntries = cache.related.get( type );
        
                if ( relatedEntries ) {
                    const key = link[ this.foreignKey ];
        
                    const related = relatedEntries.get( key );

                    if ( !related ) {
                        // TODO: Notify missing foreign keys
                        console.log( `Ignoring missing related for ${ type } ${ key }` );
                        return null;
                    }

                    if ( this.pivotField != null ) {
                        related[ this.pivotField ] = link;
                    }

                    return related;
                } else {
                    return null;
                }
            } ).filter( related => related != null );
            
            if ( this.orderByFields?.length > 0 && this.orderByLevel == 'foreign' ) {
                related.sort( sortBy( ...this.orderByFields ) );
            }
            
            return related;
        }

        return [];
    }
    
    async sync ( item : M, links : any[] ) {
        const previousLinks = await this.loadRelatedLinks( [ item ] );
        
        // If there is an ordering for the links, respect that ordering
        if ( this.orderByFields?.length > 0 && this.orderByLevel === 'pivot' ) {
            links.sort( sortBy( ...this.orderByFields ) );
            previousLinks.sort( sortBy( ...this.orderByFields ) );
        }
        
        const toDelete: any[] = [];
        const toUpdate: any[] = [];
        const toCreate: any[] = [];

        // In the end, all previous link rows that are not part of this set, 
        // can be added to the `toDelete` list
        const toUpdateSet: Set<any> = new Set();
        
        for ( const relatedRow of links ) {
            const previousRelatedRow = previousLinks.find( row => {
                return relatedRow[ this.foreignType ] == row[ this.foreignType ]
                    && relatedRow[ this.foreignKey ] == row[ this.foreignKey ]
                    // If there are multiple relations to the same foreign record,
                    // make sure each relation is only picked once
                    && !toUpdateSet.has( relatedRow );
            } );
            
            if ( previousRelatedRow != null ) {
                toUpdateSet.add( previousRelatedRow );
                
                const updatedRelatedRow : any = { ...previousRelatedRow };
                
                for ( const key of Object.keys( relatedRow ) ) {
                    if ( key == this.middleKey || key == this.foreignKey || key == this.foreignType ) {
                        continue;
                    }
                    
                    updatedRelatedRow[ key ] = relatedRow[ key ];
                }
                
                toUpdate.push( updatedRelatedRow );
            } else {
                const createdRelatedRow : any = { ...relatedRow };
                createdRelatedRow[ this.middleKey ] = item[ 'id' ];
                
                toCreate.push( createdRelatedRow );
            }
        }
        
        for ( const previousRelatedRow of previousLinks ) {
            if ( !toUpdateSet.has( previousRelatedRow ) ) {
                toDelete.push( previousRelatedRow );
            }
        }
        
        if ( toDelete.length > 0 ) await this.middleTable.deleteKeys( toDelete.map( l => l.id ) );
        if ( toUpdate.length > 0 ) {
            for ( const link of toUpdate ) {
                await this.middleTable.update( link.id, link );
            }
        }
        if ( toCreate.length > 0 ) await this.middleTable.createMany( toCreate );
    }
}
