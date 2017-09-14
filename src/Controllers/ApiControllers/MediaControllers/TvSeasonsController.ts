import { TvSeasonMediaRecord } from "../../../MediaRecord";
import { BaseTableController } from "../../BaseTableController";
import { BaseTable } from "../../../Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";

export class TvSeasonsController extends MediaTableController<TvSeasonMediaRecord> {
    sortingFields : string[] = [ 'number' ];

    defaultSortField : string = 'number';

    get table () : BaseTable<TvSeasonMediaRecord> {
        return this.server.database.tables.seasons;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );

        if ( req.query.show ) {
            query = query.filter( { tvShowId: req.query.show } );
        }
        
        return query;
    }

    async transform ( req : Request, res : Response, season : TvSeasonMediaRecord ) : Promise<any> {
        ( season as any ).cachedArtwork = this.cacheArtwork( season.kind, season.id, season.art );
        
        if ( req.query.episodes === 'true' ) {
            ( season as any ).episodes = await this.server.database.tables.episodes.find( query => {
                return query.filter( { tvSeasonId: season.id } );
            } );

            for ( let episode of ( season as any).episodes ) {
                episode.cachedArtwork = this.cacheArtwork( episode.kind, episode.id, episode.art );        
            }
        }

        return season;
    }
}