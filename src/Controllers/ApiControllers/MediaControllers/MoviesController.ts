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
        query = this.getQualityQuery( req, query );
        query = this.getTransientQuery( req, query );
        query = this.getSampleQuery( req, query );

        return query;
    }

    protected getQualityFieldQuery ( query : Knex.QueryBuilder, field: string, filters?: Record<string, string> ) : Knex.QueryBuilder {
        // DANGER!! `field` should be a safe variable, not user inputted, or it can lead to SQL Injections!
        if ( typeof filters === 'object' ) {
            const keys = Object.keys( filters );

            const included = keys.filter( key => filters[ key ] === 'include' );
            const excluded = keys.filter( key => filters[ key ] === 'exclude' );

            if ( included.length > 0 ) {
                query = query.whereExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.quality.${ field })` ).whereIn( 'value', included ) );
            }

            if ( excluded.length > 0 ) {
                query = query.whereNotExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.quality.${ field })` ).whereIn( 'value', excluded ) );
            }
        }

        return query;
    }

    public getQualityQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        query = this.getQualityFieldQuery( query, 'resolution', req.query.filterResolutions );
        query = this.getQualityFieldQuery( query, 'source', req.query.filterSources );
        query = this.getQualityFieldQuery( query, 'colorGamut', req.query.filterColorGamuts );

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

    @Route( 'get', '/quality/:field' )
    async qualities ( req : Request, res : Response ) {
        if ( req.params.field === 'resolutions' ) {
            return await this.table.queryDistinctJson( 'quality', '$.resolution', { orderBy: 'asc' } );
        } else if ( req.params.field === 'sources' ) {
            return await this.table.queryDistinctJson( 'quality', '$.source', { orderBy: 'asc' } );
        } else if ( req.params.field === 'color-gamuts' ) {
            return await this.table.queryDistinctJson( 'quality', '$.colorGamut', { orderBy: 'asc' } );
        } else {
            throw new InvalidArgumentError( `The quality field ${ req.params.field } is invalid, expected one of: resolutions, sources, color-gamuts.` );
        }
    }
}
