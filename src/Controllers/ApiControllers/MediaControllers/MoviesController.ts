import { MovieMediaRecord } from "../../../MediaRecord";
import { MediaTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaTableController } from "./MediaController";
import { Route } from "../../BaseController";
import { InvalidArgumentError } from 'restify-errors';

export class MoviesController extends MediaTableController<MovieMediaRecord> {
    sortingFields: string[] = [ 
        'title', 'rating', 'runtime', 'parentalRating', 
        'year', 'lastPlayedAt', 'playCount', 'addedAt', '$userRank'
    ];
    
    get table () : MediaTable<MovieMediaRecord> {
        return this.server.database.tables.movies;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        query = super.getQuery( req, res, query );
        query = this.getWatchedQuery( req, query );
        query = this.getRepositoryPathsQuery( req, query );
        query = this.getGenresQuery( req, query );
        query = this.getCollectionsQuery( req, query );
        query = this.getQualityQuery( req, query );
        query = this.getTransientQuery( req, query );

        return query;
    }

    protected getQualityFieldQuery ( query : r.Sequence, field: string, filters?: Record<string, string> ) : r.Sequence {
        if ( typeof filters === 'object' ) {
            const keys = Object.keys( filters );

            const included = keys.filter( key => filters[ key ] === 'include' );
            const excluded = keys.filter( key => filters[ key ] === 'exclude' );

            if ( included.length > 0 ) {
                query = query.filter( ( doc ) => {
                    return r.expr( included ).contains( doc( "quality" )( field ) as any );
                } )
            } else if ( excluded.length > 0 ) {
                query = query.filter( ( doc ) => {
                    return r.expr( excluded ).contains( doc( "quality" )( field ) as any ).not();
                } );
            }
        }

        return query;
    }

    public getQualityQuery ( req : Request, query : r.Sequence ) : r.Sequence {
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

    @Route( 'get', '/quality/:field' )
    async qualities ( req : Request, res : Response ) {
        if ( req.params.field === 'resolutions' ) {
            return this.table.find( query => {
                return ( query as any ).distinct( { index: 'qualityResolutions' } );
            } );
        } else if ( req.params.field === 'sources' ) {
            return this.table.find( query => {
                return ( query as any ).distinct( { index: 'qualitySources' } );
            } )
        } else if ( req.params.field === 'color-gamuts' ) {
            return this.table.find( query => {
                return ( query as any ).distinct( { index: 'qualityColorGamuts' } );
            } )
        } else {
            throw new InvalidArgumentError( `The quality field ${ req.params.field } is invalid, expected one of: resolutions, sources, color-gamuts.` );
        }
    }
}