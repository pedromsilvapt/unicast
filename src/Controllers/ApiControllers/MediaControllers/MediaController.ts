import { BaseTableController } from "../../BaseTableController";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaKind, MediaRecord } from "../../../MediaRecord";
import { Route } from "../../BaseController";
import { MediaTrigger } from "../../../TriggerDb";
import { MediaTable } from "../../../Database";

export abstract class MediaTableController<R extends MediaRecord, T extends MediaTable<R> = MediaTable<R>> extends BaseTableController<R, T> {
    getWatchedQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( req.query.watched === 'include' ) {
            query = query.filter( { watched: true } );
        } else if ( req.query.watched === 'exclude' ) {
            query = query.filter( { watched: false } );
        }

        return query;
    }

    getGenresQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( typeof req.query.genres === 'object' ) {
            const genres = Object.keys( req.query.genres );

            const included = genres.filter( genre => req.query.genres[ genre ] === 'include' );
            const excluded = genres.filter( genre => req.query.genres[ genre ] === 'exclude' );

            if ( included.length > 0 || excluded.length > 0 ) {
                query = query.filter( ( doc ) => {
                    if ( included.length > 0 && excluded.length > 0 ) {
                        return ( doc( "genres" ) as any ).setIntersection( included ).isEmpty().not().and(
                            ( doc( "genres" ) as any ).setIntersection( excluded ).isEmpty()
                        );
                    } else if ( included.length > 0 ) {
                        return ( doc( "genres" ) as any ).setIntersection( included ).isEmpty().not();
                    } else if ( excluded.length > 0 ) {
                        return ( doc( "genres" ) as any ).setIntersection( excluded ).isEmpty();
                    }
                } );
            }
        }

        return query;
    }

    getCollectionsQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( typeof req.query.collections === 'object' ) {
            const collections = Object.keys( req.query.collections );

            const included = collections.filter( collection => req.query.collections[ collection ] === 'include' );
            const excluded = collections.filter( collection => req.query.collections[ collection ] === 'exclude' );

            if ( included.length > 0 || excluded.length > 0 ) {
                query = ( query as any ).merge( ( record ) => {
                    const collections = ( this.server.database.tables.collectionsMedia.query()
                        .getAll( [ record( 'kind' ), record( 'id' ) ] as any, { index: 'reference' } )
                        .map( a => a( 'collectionId' ) ) as any ).coerceTo( 'array' )

                    return { collections };
                } ).filter( ( doc : any ) => {
                    if ( included.length > 0 && excluded.length > 0 ) {
                        return doc( "collections" ).setIntersection( r.expr( included ) ).isEmpty().not().and(
                            doc( "collections" ).setIntersection( r.expr( excluded ) ).isEmpty()
                        );
                    } else if ( excluded.length > 0 ) {
                        return doc( "collections" ).setIntersection( r.expr( excluded ) ).isEmpty();
                    } else if ( included.length > 0 ) {
                        return doc( "collections" ).setIntersection( r.expr( included ) ).isEmpty().not();
                    }
                } );
            }
        }

        return query;
    }

    cacheArtwork ( url : string, kind : MediaKind, id : string, art : any, prefix ?: string[] ) : any {
        const cached : any = {};

        for ( let key of Object.keys( art ) ) {
            if ( typeof art[ key ] === 'string' ) {
                cached[ key ] = `${url}/api/media/artwork/${ kind }/${ id }/${ [ ...(prefix || [] ), key ].join( '.' ) }`;
            } else if ( art[ key ] && typeof art[ key ] === 'object' ) {
                cached[ key ] = this.cacheArtwork( url, kind, id, art[ key ], [ ...( prefix || [] ), key ] );
            } else {
                cached[ key ] = art[ key ];
            }
        }

        return cached;
    }

    @Route( 'get', '/:id/triggers' )
    async triggers ( req : Request, res : Response ) : Promise<MediaTrigger[]> {
        const media : MediaRecord = await this.table.get( req.params.id );
        
        const triggers = await this.server.triggerdb.queryMediaRecord( media );

        return triggers;
    }

    @Route( 'post', '/:id/watch/:status' )
    async watch ( req : Request, res : Response ) : Promise<R> {
        const media = await this.table.get( req.params.id );

        const watched : boolean = req.params.status === 'true';
        
        await this.server.media.watchTracker.watch( media, watched );

        return this.table.get( req.params.id );
    }
}