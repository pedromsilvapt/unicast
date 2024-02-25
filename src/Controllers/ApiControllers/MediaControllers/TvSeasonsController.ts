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
        
        return query;
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
