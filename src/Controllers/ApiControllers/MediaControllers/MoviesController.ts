import { MovieMediaRecord } from "../../../MediaRecord";
import { MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";
import { Route } from "../../BaseController";

export class MoviesController extends MediaTableController<MovieMediaRecord> {
    sortingFields : string[] = [ 'title', 'rating', 'parentalRating', 'year', 'lastPlayed', 'addedAt' ]
    
    get table () : MediaTable<MovieMediaRecord> {
        return this.server.database.tables.movies;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        return this.getTransientQuery( req, 
                this.getCollectionsQuery( req,
                this.getGenresQuery( req, 
                this.getRepositoryPathsQuery( req,
                this.getWatchedQuery( req,
                    super.getQuery( req, res, query )
                ) ) ) ) );
    }

    async transformAll ( req : Request, res : Response, items : MovieMediaRecord[] ) : Promise<any[]> {
        items = await super.transformAll( req, res, items );

        const url = this.server.getMatchingUrl( req );
        
        for ( let movie of items ) {
            ( movie as any ).cachedArtwork = this.server.artwork.getCachedObject( url, movie.kind, movie.id, movie.art );
        }

        if ( req.query.collections === 'true' ) {
            await this.server.database.tables.movies.relations.collections.applyAll( items );

            for ( let item of items ) {
                if ( ( item as any ).collections.some( c => !c ) ) {
                    ( item as any ).collections = ( item as any ).collections.filter( c => !!c );
                }
            }
        }

        return items;
    }

    @Route( 'get', '/genres' )
    async genres ( req : Request, res : Response ) {
        return this.table.find( query => {
            return ( query as any ).distinct( { index: 'genres' } );
        } );
    }
}