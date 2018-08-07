import { BaseTableController } from "../../BaseTableController";
import { BaseTable, HistoryRecord } from "../../../Database/Database";
import { Request, Response } from "restify";
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";

export class SessionsController extends BaseTableController<HistoryRecord> {
    defaultSortField : string = 'createdAt';

    defaultSortFieldDirection : 'asc' | 'desc' = 'desc';    

    sortingFields : string[] = [ 'createdAt' ];

    searchFields : string[] = [];

    allowedActions : string[] = [ 'list', 'get' ];

    async transformAll ( req : Request, res : Response, history : HistoryRecord[] ) : Promise<any[]> {
        history = await super.transformAll( req, res, history );

        const url = await this.server.getMatchingUrl( req );
    
        if ( req.query.records === 'true' ) {
            await this.server.database.tables.history.relations.record.applyAll( history );

            for ( let historySession of history ) {
                const item = ( historySession as any ).record as MediaRecord;

                if ( item ) {
                    ( item as any ).cachedArtwork = this.server.artwork.getCachedObject( url, item.kind, item.id, item.art );
                }
            }
        }

        return history;
    }

    get table () : BaseTable<HistoryRecord> {
        return this.server.database.tables.history;
    }
}