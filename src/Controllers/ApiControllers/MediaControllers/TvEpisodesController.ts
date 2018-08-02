import { TvEpisodeMediaRecord } from "../../../MediaRecord";
import { MediaTable } from "../../../Database";
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
        if ( req.query.show && req.query.seasonNumber ) {
            const season = await this.server.database.tables.seasons.find( query => query.filter( { tvShowId: req.query.show, number: +req.query.seasonNumber } ) );

            if ( season.length ) {
                req.query.season = season[ 0 ].id;
            }
        }
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );

        if ( req.query.season ) {
            query = query.filter( { tvSeasonId: req.query.season } );
        }

        return this.getTransientQuery( req, this.getWatchedQuery( req, query ) );
    }

    async transform ( req : Request, res : Response, episode : TvEpisodeMediaRecord ) : Promise<any> {
        const url = await this.server.getMatchingUrl( req );
        
        ( episode as any ).cachedArtwork = this.server.artwork.getCachedObject( url, episode.kind, episode.id, episode.art );
        
        return episode;
    }
}