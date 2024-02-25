import { BaseTableController } from "../../BaseTableController";
import { BaseTable, HistoryRecord } from "../../../Database/Database";
import { Request, Response } from "restify";
import { Knex } from 'knex';
import { MediaKind, MediaRecord } from '../../../MediaRecord';
import { AsyncStream } from 'data-async-iterators';

export class SessionsController extends BaseTableController<HistoryRecord> {
    defaultSortField : string = 'createdAt';

    defaultSortFieldDirection : 'asc' | 'desc' = 'desc';

    sortingFields : string[] = [ 'createdAt' ];

    searchFields : string[] = [];

    allowedActions : string[] = [ 'list', 'get', 'delete' ];

    async transformAll ( req : Request, res : Response, history : HistoryRecord[] ) : Promise<any[]> {
        history = await super.transformAll( req, res, history );

        const url = this.server.getMatchingUrl( req );

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

    async transformQuery ( req : Request ) {
        await super.transformQuery( req );

        if ( req.query.filterMedia ) {
            const media : [ MediaKind, string ][] = req.query.filterMedia.map( id => id.split( ',' ) );

            const playables = await AsyncStream.from( media )
                .flatMapConcurrent( ( [ kind, id ] ) => this.server.media.getPlayables( kind, id ), 10 )
                .map( rec => rec.kind + ',' + rec.id )
                .toArray();

            req.query.filterPlayableMedia = playables;
        }
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );

        if ( req.query.filterPlayableMedia ) {
            const media : string[] = req.query.filterPlayableMedia;

            // We can compare only by the Media Id because it is unique across all kinds
            query = query.whereIn( 'mediaId', media.map( pair => pair.split( ',' )[ 1 ] ) );
        }

        if ( req.query.filterDateStart ) {
            query = query.where( 'createdAt', '>', +req.query.filterDateStart );
        }

        if ( req.query.filterDateEnd ) {
            query = query.where( 'createdAt', '<', +req.query.filterDateEnd );
        }

        return query;
    }

    get table () : BaseTable<HistoryRecord> {
        return this.server.database.tables.history;
    }
}
