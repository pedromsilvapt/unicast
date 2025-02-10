import { MovieMediaRecord } from "../../../MediaRecord";
import { AbstractMediaTable, MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { Knex } from 'knex';
import { MediaTableController } from "./MediaController";
import { Route } from "../../BaseController";
import { InvalidArgumentError } from 'restify-errors';

export class MoviesController extends MediaTableController<MovieMediaRecord> {
    sortingFields: string[] = [
        'title', 'rating', 'runtime', 'parentalRating',
        'year', 'lastPlayedAt', 'playCount', 'addedAt', '$userRank'
    ];

    get table () : AbstractMediaTable<MovieMediaRecord> {
        return this.server.database.tables.movies;
    }

    getQuery ( req : Request, res : Response, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = super.getQuery( req, res, query );
        query = this.getWatchedQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getGenresQuery( req, query );
        query = this.getCollectionsQuery( req, query );
        query = this.getMetadataQuery( req, query, this.table.tableName );
        query = this.getTransientQuery( req, query );
        query = this.getSampleQuery( req, query );

        return query;
    }

    async transformAll ( req : Request, res : Response, items : MovieMediaRecord[] ) : Promise<any[]> {
        items = await super.transformAll( req, res, items );

        const url = this.server.getMatchingUrl( req );

        for ( let movie of items ) {
            ( movie as any ).cachedArtwork = this.server.artwork.getCachedObject( url, movie.kind, movie.id, movie.art );
        }

        if ( req.query.collections === 'true' ) {
            await this.server.database.tables.movies.relations.collections.applyAll( items );
        }

        return items;
    }

    @Route( 'get', '/genres' )
    async genres ( req : Request, res : Response ) {
        return await this.table.queryDistinctJsonArray('genres', '$', { orderBy: 'asc' });
    }
}

export interface PlayableMediaQualities {
    resolutions: string[];
    videoCodecs: string[];
    colorspaces: string[];
    bitdepths: string[];
    audioCodecs: string[];
    channels: string[];
    languages: string[];
    sources: string[];
}
