import { MovieMediaRecord } from "../../../MediaRecord";
import { BaseTableController } from "../../BaseTableController";
import { BaseTable } from "../../../Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";
import { Route } from "../../BaseController";

export class MoviesController extends MediaTableController<MovieMediaRecord> {
    sortingFields : string[] = [ 'title', 'rating', 'parentalRating', 'year', 'lastPlayed', 'addedAt' ]
    
    get table () : BaseTable<MovieMediaRecord> {
        return this.server.database.tables.movies;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        return this.getCollectionsQuery( req,
                this.getGenresQuery( req, 
                this.getWatchedQuery( req,
                    super.getQuery( req, res, query )
                ) ) );
    }

    async transform ( req : Request, res : Response, movie : MovieMediaRecord ) : Promise<any> {
        ( movie as any ).cachedArtwork = this.cacheArtwork( movie.kind, movie.id, movie.art );

        if ( req.query.collections === 'true' ) {
            ( movie as any ).collections = await this.server.media.getCollections( movie.kind, movie.id );
        }

        return movie;
    }

    @Route( 'get', '/genres' )
    async genres ( req : Request, res : Response ) {
        return this.table.find( query => {
            return query.distinct( { index: 'genres' } );
        } );
    }
}