import { CustomMediaRecord } from "../../../MediaRecord";
import { MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";

export class CustomController extends MediaTableController<CustomMediaRecord> {
    sortingFields : (keyof CustomMediaRecord)[] = [ 
        'title', 'lastPlayedAt', 'addedAt', 'playCount'
    ];
    
    get table () : MediaTable<CustomMediaRecord> {
        return this.server.database.tables.custom;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        return this.getTransientQuery( req, 
                    this.getWatchedQuery( req,
                    super.getQuery( req, res, query )
                ) );
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