import { BaseTableController } from "../../BaseTableController";
import { BaseTable, HistoryRecord } from "../../../Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { Route } from "../../BaseController";

export class SessionsController extends BaseTableController<HistoryRecord> {
    defaultSortField : string = 'createdAt';

    defaultSortFieldDirection : 'asc' | 'desc' = 'desc';    

    sortingFields : string[] = [ 'createdAt' ];

    searchFields : string[] = [];

    allowedActions : string[] = [ 'list', 'get' ];

    async transform ( req : Request, res : Response, history : HistoryRecord ) : Promise<any> {
        if ( req.query.items === 'true' ) {
            ( history as any ).item = await this.server.media.get( history.reference.kind, history.reference.id );
        }

        return history;
    }
    
    get table () : BaseTable<HistoryRecord> {
        return this.server.database.tables.history;
    }
}