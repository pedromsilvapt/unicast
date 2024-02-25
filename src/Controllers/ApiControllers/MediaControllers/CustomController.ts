import { CustomMediaRecord } from "../../../MediaRecord";
import { AbstractMediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { Knex } from 'knex';
import { MediaTableController } from "./MediaController";

export class CustomController extends MediaTableController<CustomMediaRecord> {
    sortingFields : (keyof CustomMediaRecord)[] = [ 
        'title', 'lastPlayedAt', 'addedAt', 'playCount'
    ];
    
    get table () : AbstractMediaTable<CustomMediaRecord> {
        return this.server.database.tables.custom;
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );
        query = this.getWatchedQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getGenresQuery( req, query );
        query = this.getCollectionsQuery( req, query );
        query = this.getTransientQuery( req, query );
        query = this.getSampleQuery( req, query );
        
        return query;
    }

    async transformAll ( req : Request, res : Response, items : CustomMediaRecord[] ) : Promise<any[]> {
        items = await super.transformAll( req, res, items );

        const url = this.server.getMatchingUrl( req );
        
        for ( let custom of items ) {
            ( custom as any ).cachedArtwork = this.server.artwork.getCachedObject( url, custom.kind, custom.id, custom.art );
        }

        return items;
    }
}
