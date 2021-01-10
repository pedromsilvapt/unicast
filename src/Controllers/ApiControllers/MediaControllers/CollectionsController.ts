import { BaseTableController } from "../../BaseTableController";
import { CollectionRecord, BaseTable, CollectionsTable, TreeIterationOrder } from "../../../Database/Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { Route } from "../../BaseController";

export class CollectionsController extends BaseTableController<CollectionRecord> {
    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );

        if ( req.query.kind ) {
            query = query.filter( collection => collection( 'kinds' ).contains( req.query.kind ).or( collection( 'kinds' ).contains( 'all' ) ) );
        }

        return query;
    }

    async transformAll ( req : Request, res : Response, collections : CollectionRecord[] ) : Promise<any> {
        collections = await super.transformAll( req, res, collections );

        if ( req.query.items === 'true' ) {
            await this.server.database.tables.collections.relations.records.applyAll( collections );
        }

        if ( req.query.tree === 'true' ) {
            return CollectionsTable.buildTree( collections );
        }

        return collections;
    }
    
    get table () : BaseTable<CollectionRecord> {
        return this.server.database.tables.collections;
    }

    @Route( 'post', '/:id/insert/:mediaKind/:mediaId' )
    async insert ( req : Request, res : Response ) : Promise<void> {
        const { id, mediaKind, mediaId } = req.params;

        const collections = await this.server.media.getCollections( mediaKind, mediaId );

        if ( !collections.find( col => col.id == id ) ) {
            await this.server.database.tables.collectionsMedia.create( {
                collectionId: id,
                mediaId: mediaId,
                mediaKind: mediaKind,
                createdAt: new Date()
            } );
        }
    }

    @Route( 'post', '/:id/remove/:mediaKind/:mediaId' )
    async remove ( req : Request, res : Response ) : Promise<void> {
        const { id, mediaKind, mediaId } = req.params;

        const collections = await this.server.media.getCollections( mediaKind, mediaId );

        if ( collections.find( col => col.id == id ) ) {
            await this.server.database.tables.collectionsMedia.deleteMany( {
                collectionId: id,
                mediaKind: mediaKind,
                mediaId: mediaId
            } );
        }
    }

    @Route( 'del', '/:id/:kind' )
    async removeKind ( req : Request, res : Response ) : Promise<void> {
        const { id, kind } = req.params;

        const collections = CollectionsTable.buildTree( await this.table.find() );

        const collection = CollectionsTable.findInTrees( collections, col => col.id == id );

        const order = TreeIterationOrder.BottomUp;
        
        // TODO Parallelize the requests/batch them when possible
        for ( let child of CollectionsTable.iterateTrees( [ collection ], order ) ) {
            child.kinds = child.kinds.filter( eachKind => eachKind != kind );

            if ( child.kinds.length == 0 ) {
                await this.server.database.tables.collectionsMedia.deleteMany( { collectionId: child.id } );

                await this.table.delete( child.id );
            } else {
                await this.server.database.tables.collectionsMedia.deleteMany( {
                    collectionId: child.id,
                    mediaKind: kind,
                } );
    
                await this.table.update( child.id, { kinds: child.kinds } );
            }
        }
    }
}