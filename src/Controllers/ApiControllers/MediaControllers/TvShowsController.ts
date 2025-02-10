import { TvShowMediaRecord } from "../../../MediaRecord";
import { AbstractMediaTable, MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { MediaTableController } from "./MediaController";
import { Knex } from 'knex';
import { Route } from '../../BaseController';

export class TvShowsController extends MediaTableController<TvShowMediaRecord> {
    sortingFields : string[] = [
        'title', 'seasonsCount', 'rating', 'parentalRating',
        'year', 'lastPlayedAt', 'addedAt', 'playCount'
    ];

    get table () : AbstractMediaTable<TvShowMediaRecord> {
        return this.server.database.tables.shows;
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );
        query = this.getWatchedQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getGenresQuery( req, query );
        query = this.getCollectionsQuery( req, query );
        query = this.getNestedEpisodesQuery( query, epQuery => this.getMetadataQuery( req, epQuery, this.server.database.tables.episodes.tableName ) );
        query = this.getTransientQuery( req, query );
        query = this.getSampleQuery( req, query );

        return query;
    }

    getNestedEpisodesQuery ( query : Knex.QueryBuilder, callback : ( epQuery : Knex.QueryBuilder ) => Knex.QueryBuilder ) : Knex.QueryBuilder {
        const seasons = this.server.database.tables.seasons;
        const episodes = this.server.database.tables.episodes;

        const episodesQuery = seasons.query()
            .select( episodes.tableName + '.id' )
            .leftJoin( episodes.tableName, seasons.tableName + '.id', episodes.tableName + '.tvSeasonId' )
            .whereRaw( `${ this.table.tableName }.id = ${ seasons.tableName }.tvShowId` );

        const filteredEpisodesQuery = callback( episodesQuery );

        // To use this function, it assumes that any filters set inside it's callback clone the query before modifying it.
        // This makes it possible to detect if any changes were made to the query, and only if so, do we need to run the "exists" condition
        // Otherwise, we can simply return the original query for execution
        if ( filteredEpisodesQuery == episodesQuery ) {
            return query;
        }

        return query.whereExists( filteredEpisodesQuery );
    }

    async transformAll ( req : Request, res : Response, shows : TvShowMediaRecord[] ) : Promise<any> {
        shows = await super.transformAll( req, res, shows );

        const url = this.server.getMatchingUrl( req );

        if ( req.query.seasons === 'true' ) {
            await this.server.database.tables.shows.relations.seasons.applyAll( shows );
        }

        if ( req.query.collections === 'true' ) {
            await this.server.database.tables.shows.relations.collections.applyAll( shows );

            for ( let item of shows ) {
                if ( ( item as any ).collections.some( c => !c ) ) {
                    ( item as any ).collections = ( item as any ).collections.filter( c => !!c );
                }
            }
        }

        for ( let show of shows ) {
            ( show as any ).cachedArtwork = this.server.artwork.getCachedObject( url, show.kind, show.id, show.art );

            if ( req.query.seasons === 'true' ) {
                for ( let season of ( show as any).seasons ) {
                    season.cachedArtwork = this.server.artwork.getCachedObject( url, season.kind, season.id, season.art );
                }
            }
        }

        return shows;
    }

    @Route( 'get', '/genres' )
    async genres ( req : Request, res : Response ) {
        return await this.table.queryDistinctJsonArray('genres', '$', { orderBy: 'asc' });
    }
}
