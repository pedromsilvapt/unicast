import { TvShowMediaRecord } from "../../../MediaRecord";
import { BaseTableController } from "../../BaseTableController";
import { BaseTable } from "../../../Database";
import { Request, Response } from "restify";
import { MediaTableController } from "./MediaController";
import * as r from 'rethinkdb';

export class TvShowsController extends MediaTableController<TvShowMediaRecord> {
    sortingFields : string[] = [ 'title', 'seasonsCount', 'rating', 'parentalRating', 'year', 'lastPlayed', 'addedAt' ]

    get table () : BaseTable<TvShowMediaRecord> {
        return this.server.database.tables.shows;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        return this.getCollectionsQuery( req,
                this.getGenresQuery( req, 
                this.getWatchedQuery( req,
                    super.getQuery( req, res, query )
                ) ) );
    }

    async transform ( req : Request, res : Response, show : TvShowMediaRecord ) : Promise<any> {
        ( show as any ).cachedArtwork = this.cacheArtwork( show.kind, show.id, show.art );
        
        if ( req.query.seasons === 'true' ) {
            ( show as any ).seasons = await this.server.database.tables.seasons.find( query => {
                return query.orderBy( { index: 'number' } ).filter( { tvShowId: show.id } );
            } );

            for ( let season of ( show as any).seasons ) {
                season.cachedArtwork = this.cacheArtwork( season.kind, season.id, season.art );        
            }
        }

        if ( req.query.categories === 'true' ) {
            ( show as any ).categories = await this.server.media.getCollections( show.kind, show.id );
        }

        return show;
    }
}