import { BaseTableController } from "../../BaseTableController";
import { CollectionRecord, BaseTable } from "../../../Database";
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

    async transform ( req : Request, res : Response, collection : CollectionRecord ) : Promise<any> {
        if ( req.query.items === 'true' ) {
            ( collection as any ).items = await this.server.media.getCollectionItems( collection.id );
        }

        return collection;
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
}