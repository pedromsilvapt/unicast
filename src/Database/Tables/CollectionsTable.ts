import { collect, groupingBy, mapping, toSet } from 'data-collectors';
import { MediaRecord } from '../../MediaRecord';
import { BaseTable, DatabaseTables, createMediaRecordPolyMap } from '../Database';
import { ManyToManyPolyRelation } from '../Relations/ManyToManyPolyRelation';
import { BelongsToOneRelation } from '../Relations/OneToOneRelation';
import { PolyRelationMap } from '../Relations/PolyRelation';
import { Converters, FieldConverters } from '../Converters';
import { BaseRecord, BaseRecordSql, TimestampedRecord, TimestampedRecordSql } from './BaseTable';

export class CollectionsTable extends BaseTable<CollectionRecord> {
    readonly tableName : string = 'collections';

    declare relations: {
        records: ManyToManyPolyRelation<CollectionRecord, MediaRecord>;
        parent: BelongsToOneRelation<CollectionRecord, CollectionRecord>;
    }
    
    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            records: new ManyToManyPolyRelation( 'records', map, tables.collectionsMedia, 'collectionId', 'mediaKind', 'mediaId' ),
            parent: new BelongsToOneRelation( 'parent', this, 'parentId' ),
        };
    }

    fieldConverters: FieldConverters<CollectionRecord, CollectionRecordSql> = {
        id: Converters.id(),
        parentId: Converters.id(),
        kinds: Converters.json(),
        primary: Converters.bool(),
        updatedAt: Converters.date(),
        createdAt: Converters.date(),
    };

    identifierFields: string[] = [ 'title' ];

    protected static buildTreeNode ( record : CollectionTreeRecord, collectionsDictionary : Map<string, CollectionTreeRecord[]> ) : CollectionTreeRecord {
        if ( record.children != null ) {
            return record;
        }

        record.children = collectionsDictionary.get( record.id ) || [];

        for ( let child of record.children ) {
            this.buildTreeNode( child, collectionsDictionary );
        }

        return record;
    }

    public static buildTree ( collections: CollectionRecord[] ) : CollectionTreeRecord[] {
        const collectionsDictionary = collect( collections, groupingBy( item => item.parentId ) );
        const collectionsSet = collect( collections, mapping( col => col.id, toSet() ) );

        return collections
            .filter( record => record.parentId == null || !collectionsSet.has( record.parentId ) )
            .map( record => CollectionsTable.buildTreeNode( record, collectionsDictionary ) );
    }

    public static findInTrees ( collections: CollectionTreeRecord[], predicate : ( col: CollectionTreeRecord ) => boolean ) : CollectionTreeRecord {
        let result : CollectionTreeRecord = null;

        for ( let node of collections ) {
            if ( predicate( node ) ) {
                return node;
            }

            if ( result = this.findInTrees( node.children, predicate ) ) {
                return result;
            }
        }
    }

    public static * iterateTrees ( collections: CollectionTreeRecord[], order : TreeIterationOrder = TreeIterationOrder.TopDown ) : IterableIterator<CollectionTreeRecord> {
        for ( let node of collections ) {
            if ( order == TreeIterationOrder.BottomUp && node.children.length > 0 ) {
                yield * this.iterateTrees( node.children );
            }

            yield node;

            if ( order == TreeIterationOrder.TopDown && node.children.length > 0 ) {
                yield * this.iterateTrees( node.children );
            }
        }
    }
}

export interface CollectionRecord extends BaseRecord, TimestampedRecord {
    parentId ?: string;
    title : string;
    color : string;
    kinds : string[];
    primary : boolean;
}


export interface CollectionRecordSql extends BaseRecordSql, TimestampedRecordSql {
    parentId ?: number;
    kinds : string;
    primary : number;
}

export interface CollectionTreeRecord extends CollectionRecord {
    children ?: CollectionTreeRecord[];
}

export enum TreeIterationOrder {
    TopDown,
    BottomUp,
}
