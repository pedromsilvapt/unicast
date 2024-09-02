import { TableRecord, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import { MediaCastRecord } from '../../MediaRecord';

export function mapMap<K, V, U> ( map : Map<K, V>, mapper : ( value : V, key : K ) => U ) : Map<K, U> {
    const newMap = new Map<K, U>();

    for ( let [ key, value ] of map ) {
        newMap.set( key, mapper( value, key ) );
    }

    return newMap;
}

export function mapMapArray<K, V, U> ( map : Map<K, V[]>, mapper : ( value : V, key : K ) => U ) : Map<K, U[]> {
    return mapMap( map, ( array, key ) => array.map( value => mapper( value, key ) ) );
}

export interface ManyToManyCache<R extends TableRecord> {
    links : Map<string, string[]>;
    related : Map<string, R>;
    pivots : Map<string, Map<string, any>>;
}

export class ManyToManyRelation<M extends TableRecord, R extends TableRecord> extends Relation<M, R[]> {
    public middleTable : BaseTable<any>;

    public relatedTable : BaseTable<R>;

    public recordForeign : string;

    public relatedForeign : string;

    // If the inverse of this relationship is a polymorphic relationship, then we need to be able
    // to restrict selecting only links of said polymorphic value using the field set here
    public recordForeignType : string;

    public recordForeignTypeValue : string;

    public pivotField : string = null;   

    public subRelations : Relation<R, any>[] = [];

    constructor ( member : string, middleTable : BaseTable<any>, relatedTable : BaseTable<R>, recordForeign : string, relatedForeign : string ) {
        super( member );

        this.middleTable = middleTable;
        this.relatedTable = relatedTable;
        this.recordForeign = recordForeign;
        this.relatedForeign = relatedForeign;
    }

    public with ( ...subRelations : Relation<R, any>[] ) : ManyToManyRelation<M, R> {
        const relation = new ManyToManyRelation( 
            this.member, 
            this.middleTable, 
            this.relatedTable, 
            this.recordForeign, 
            this.relatedForeign 
        );

        relation.subRelations = [ ...this.subRelations ];
        relation.subRelations.push( ...subRelations );

        return relation;
    }

    poly ( field : string, value : string ) : this {
        this.recordForeignType = field;
        this.recordForeignTypeValue = value;

        return this;
    }

    savePivot ( pivotField : string ) : this {
        this.pivotField = pivotField;
        
        return this;
    }

    async loadSubRelations ( records : R[] ) {
        for ( let relation of this.subRelations ) {
            await relation.applyAll( records );
        }
    }
    
    async loadRelatedLinks ( items : M[] ) : Promise<any[]> {
        const keys = items.map( item => item.id );

        const middleTable = this.middleTable;
        
        return await middleTable.findAll( keys, { 
            column: this.recordForeign,
            query: query => this.recordForeignType != null 
                ? query.andWhere( this.recordForeignType, this.recordForeignTypeValue ) 
                : query,
        } );
    }

    buildRelatedCache ( middleTableItems : any[], related : R[] ) : ManyToManyCache<R> {
        const links : Map<string, string[]> = mapMapArray( itt( middleTableItems ).groupBy( item => item[ this.recordForeign ] as string ), item => item[ this.relatedForeign ] as string );
        
        const relatedMap : Map<string, R> = itt( related ).keyBy( rel => rel.id );

        const pivots : Map<string, Map<string, any>> = mapMap( 
            itt( middleTableItems ).groupBy( item => item[ this.recordForeign ] as string ),
            items => itt( items ).keyBy( item => item[ this.relatedForeign ] as string )
        );

        return { links, related: relatedMap, pivots };
    }

    async loadRelated ( items : M[] ) : Promise<ManyToManyCache<R>> {
        const middleTableItems = await this.loadRelatedLinks( items );

        const middleKeys = middleTableItems.map( item => item[ this.relatedForeign ] );

        // const related = this.pivotIndexOut != null
        //     ? await this.relatedTable.findAll( middleKeys, { index: this.pivotIndexOut } )
        //     : await this.relatedTable.findAll( middleKeys );
        const related = await this.relatedTable.findAll( middleKeys );
        
        await this.loadSubRelations( related );

        return this.buildRelatedCache( middleTableItems, related );
    }

    findRelated ( item : M, cache : ManyToManyCache<R> ) : R[] {
        const relatedIds = cache.links.get( item.id );

        if ( relatedIds ) {
            if ( this.pivotField != null ) {
                return relatedIds.map( id => {
                    const related = cache.related.get( id );
                    
                    if ( !related ) {
                        // TODO: Notify missing foreign keys
                        return null;
                    }

                    const pivot : MediaCastRecord = cache.pivots.get( item.id ).get( id );

                    related[ this.pivotField ] = pivot;

                    return related;
                } ).filter( related => related != null );
            } else {
                return relatedIds.map( id => cache.related.get( id ) );
            }
        }

        return [];
    }
}
