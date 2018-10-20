import { TvEpisodeMediaRecord } from "../../../MediaRecord";
import { MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";

export class TvEpisodesController extends MediaTableController<TvEpisodeMediaRecord> {
    sortingFields : string[] = [ 'title', 'number', 'lastPlayed', 'addedAt' ];

    defaultSortField : string = 'number';

    get table () : MediaTable<TvEpisodeMediaRecord> {
        return this.server.database.tables.episodes;
    }

    async transformQuery ( req : Request ) : Promise<void> {
        if ( req.query.show ) {

            if ( req.query.seasonNumber ) {
                const season = await this.server.database.tables.seasons.find( query => query.filter( { tvShowId: req.query.show, number: +req.query.seasonNumber } ) );

                if ( season.length ) {
                    req.query.season = season[ 0 ].id;
                }
            } else {
                const seasons = await this.server.database.tables.seasons.find( query => query.filter( { tvShowId: req.query.show } ) );

                req.query.seasons = seasons.map( s => s.id );
            }
        }
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );

        if ( req.query.season ) {
            query = query.filter( { tvSeasonId: req.query.season } );
        } else if ( req.query.seasons ) {
            query = query.filter( doc => r.expr( req.query.seasons ).contains( ( doc as any )( 'tvSeasonId' ) ) );
        }

        return this.getTransientQuery( req, this.getWatchedQuery( req, query ) );
    }

    async transform ( req : Request, res : Response, episode : TvEpisodeMediaRecord ) : Promise<any> {
        const url = await this.server.getMatchingUrl( req );
        
        ( episode as any ).cachedArtwork = this.server.artwork.getCachedObject( url, episode.kind, episode.id, episode.art );
        
        return episode;
    }
}