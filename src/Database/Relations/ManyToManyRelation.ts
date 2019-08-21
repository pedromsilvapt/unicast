import { Record, Relation } from "./Relation";
import { BaseTable } from "../Database";
import * as itt from "itt";
import * as r from 'rethinkdb';
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

export interface ManyToManyCache<R extends Record> {
    links : Map<string, string[]>;
    related : Map<string, R>;
    pivots : Map<string, Map<string, any>>;
}

export class ManyToManyRelation<M extends Record, R extends Record> extends Relation<M, R[]> {
    public middleTable : BaseTable<any> | string;

    public relatedTable : BaseTable<R>;

    public recordForeign : string;

    public relatedForeign : string;

    // If the inverse of this relationship is a polymorphic relationship, then we need to be able
    // to restrict selecting only links of said polymorphic value using the field set here
    public recordForeignType : string;

    public recordForeignTypeValue : string;

    public pivotField : string = null;

    public pivotIndexIn : string = null;

    public pivotIndexOut : string = null;

    constructor ( member : string, middleTable : string | BaseTable<any>, relatedTable : BaseTable<R>, recordForeign : string, relatedForeign : string ) {
        super( member );

        this.middleTable = middleTable;
        this.relatedTable = relatedTable;
        this.recordForeign = recordForeign;
        this.relatedForeign = relatedForeign;
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

    pivotIndexedBy ( inputIndexName : string, outputIndexName : string = null ) : this {
        this.pivotIndexIn = inputIndexName;
        this.pivotIndexOut = outputIndexName;
        
        return this;
    }

    async loadRelatedLinks ( items : M[] ) : Promise<any[]> {
        const keys = items.map( item => item.id );

        const middleTable = this.middleTable;
        if ( typeof middleTable === 'string' ) {
            return items.map( item => {
                return item[ middleTable ]
                    .map( link => {
                        const foreign = typeof link === 'string' ? link : link[ this.relatedForeign ];

                        return { [ this.recordForeign ]: item.id, [ this.relatedForeign ]: foreign };
                    } ) ;
            } );
        } else {
            if ( this.pivotIndexIn != null ) {
                if ( this.recordForeignType != null ) {
                    return await middleTable.findAll( keys.map( key => [ this.recordForeignTypeValue, key ] ), { index: this.pivotIndexIn } );
                } else {
                    return await middleTable.findAll( keys, { index: this.pivotIndexIn } );
                }
            } else {
                return await middleTable.find( query => {
                    query = query.filter( row => r.expr( keys ).contains( row( this.recordForeign ) as any ) ) 

                    if ( this.recordForeignType ) {
                        query = query.filter( row => row( this.recordForeignType ).eq( this.recordForeignTypeValue ) );
                    }

                    return query;
                } );
            }
        }
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

        const related = this.pivotIndexOut != null
            ? await this.relatedTable.findAll( middleKeys, { index: this.pivotIndexOut } )
            : await this.relatedTable.findAll( middleKeys ); // await this.relatedTable.find( query => this.runQuery( query.filter( row => r.expr( middleKeys ).contains( row( 'id' ) as any ) ) ) );
        
        return this.buildRelatedCache( middleTableItems, related );
    }

    findRelated ( item : M, cache : ManyToManyCache<R> ) : R[] {
        const relatedIds = cache.links.get( item.id );

        if ( relatedIds ) {
            if ( this.pivotField != null ) {
                return relatedIds.map( id => {
                    const related = cache.related.get( id );
                    
                    const pivot : MediaCastRecord = cache.pivots.get( item.id ).get( id );

                    related[ this.pivotField ] = pivot;

                    return related;
                } );
            } else {
                return relatedIds.map( id => cache.related.get( id ) );
            }
        }

        return [];
    }
}