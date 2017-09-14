import { BaseTableController } from "../../BaseTableController";
import { CollectionRecord, BaseTable } from "../../../Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';

export class CollectionsController extends BaseTableController<CollectionRecord> {
    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );

        if ( req.query.kind ) {
            query = query.filter( collection => collection( 'kinds' ).contains( req.query.kind ).or( collection( 'kinds' ).contains( 'all' ) ) );
        }

        return query;
    }
    
    get table () : BaseTable<CollectionRecord> {
        return this.server.database.tables.collections;
    }
}