import { TvEpisodeMediaRecord } from "../../../MediaRecord";
import { AbstractMediaTable, MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { Knex } from 'knex';
import { MediaTableController } from "./MediaController";

export class TvEpisodesController extends MediaTableController<TvEpisodeMediaRecord> {
    sortingFields : string[] = [ 'title', 'number', 'lastPlayedAt', 'airedAt', 'addedAt', 'playCount' ];
    
    defaultSortField : string = 'number';

    get table () : AbstractMediaTable<TvEpisodeMediaRecord> {
        return this.server.database.tables.episodes;
    }

    async transformQuery ( req : Request ) : Promise<void> {
        await super.transformQuery( req );
        
        if ( req.query.show ) {

            if ( req.query.seasonNumber ) {
                const season = await this.server.database.tables.seasons.find( query => query.where( { tvShowId: req.query.show, number: +req.query.seasonNumber } ) );

                if ( season.length ) {
                    req.query.season = season[ 0 ].id;
                }
            } else {
                const seasons = await this.server.database.tables.seasons.find( query => query.where( { tvShowId: req.query.show } ) );

                req.query.seasons = seasons.map( s => s.id );
            }
        }
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );

        if ( req.query.season ) {
            query = query.where( { tvSeasonId: req.query.season } );
        } else if ( req.query.seasons ) {
            query = query.whereIn( 'tvSeasonId', req.query.seasons );
        }

        query = this.getWatchedQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getTransientQuery( req, query );
        
        return query;
    }

    async transform ( req : Request, res : Response, episode : TvEpisodeMediaRecord ) : Promise<any> {
        const url = this.server.getMatchingUrl( req );
        
        ( episode as any ).cachedArtwork = this.server.artwork.getCachedObject( url, episode.kind, episode.id, episode.art );
        
        return episode;
    }
}
