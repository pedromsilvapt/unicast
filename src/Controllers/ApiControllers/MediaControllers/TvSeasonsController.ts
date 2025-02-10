import { TvSeasonMediaRecord } from "../../../MediaRecord";
import { AbstractMediaTable, MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { Knex } from 'knex';
import { MediaTableController } from "./MediaController";
import { Route } from '../../BaseController';

export class TvSeasonsController extends MediaTableController<TvSeasonMediaRecord> {
    sortingFields : string[] = [ 'number', 'lastPlayedAt', 'playCount' ];

    defaultSortField : string = 'number';

    get table () : AbstractMediaTable<TvSeasonMediaRecord> {
        return this.server.database.tables.seasons;
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );

        if ( req.query.show ) {
            query = query.where( { tvShowId: req.query.show } );
        }

        query = this.getTransientQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getNestedEpisodesQuery( query, epQuery => this.getMetadataQuery( req, epQuery, this.server.database.tables.episodes.tableName ) );

        return query;
    }

    getNestedEpisodesQuery ( query : Knex.QueryBuilder, callback : ( epQuery : Knex.QueryBuilder ) => Knex.QueryBuilder ) : Knex.QueryBuilder {
        const seasons = this.server.database.tables.seasons;
        const episodes = this.server.database.tables.episodes;

        const episodesQuery = seasons.query()
            .select( episodes.tableName + '.id' )
            .whereRaw( `${ this.table.tableName }.id = ${ episodes.tableName }.tvSeasonId` );

        const filteredEpisodesQuery = callback( episodesQuery );

        // To use this function, it assumes that any filters set inside it's callback clone the query before modifying it.
        // This makes it possible to detect if any changes were made to the query, and only if so, do we need to run the "exists" condition
        // Otherwise, we can simply return the original query for execution
        if ( filteredEpisodesQuery == episodesQuery ) {
            return query;
        }

        return query.whereExists( filteredEpisodesQuery );
    }

    async transformAll ( req : Request, res : Response, seasons : TvSeasonMediaRecord[] ) : Promise<any> {
        if ( req.query.episodes === 'true' ) {
            await this.server.database.tables.seasons.relations.episodes.applyAll( seasons );
        }

        for ( let season of seasons ) {
            const url = this.server.getMatchingUrl( req );

            ( season as any ).cachedArtwork = this.server.artwork.getCachedObject( url, season.kind, season.id, season.art );

            if ( req.query.episodes === 'true' ) {
                for ( let episode of ( season as any).episodes ) {
                    episode.cachedArtwork = this.server.artwork.getCachedObject( url, episode.kind, episode.id, episode.art );
                }
            }
        }

        return seasons;
    }

    @Route( 'get', '/:id/subtitles' )
    async subtitles ( req : Request, res : Response ) {
        const episodes = await this.server.media.getSeasonEpisodes( req.params.id );

        const subtitles : any = {};

        for ( let episode of episodes ) {
            subtitles[ episode.number ] = await this.server.subtitles.list( episode );
        }

        return subtitles;
    }
}
