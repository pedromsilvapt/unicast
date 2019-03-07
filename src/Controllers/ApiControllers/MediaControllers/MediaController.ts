import { BaseTableController } from "../../BaseTableController";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaRecord, ArtRecord } from "../../../MediaRecord";
import { Route } from "../../BaseController";
import { MediaTrigger } from "../../../TriggerDb";
import { MediaTable } from "../../../Database/Database";
import { ResourceNotFoundError, InvalidArgumentError } from 'restify-errors';

export abstract class MediaTableController<R extends MediaRecord, T extends MediaTable<R> = MediaTable<R>> extends BaseTableController<R, T> {
    getTransientQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        return ( query.filter as any )( doc => doc( 'transient' ).eq( false ), { default: true } );
    }

    getWatchedQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( req.query.filterWatched === 'include' ) {
            query = query.filter( { watched: true } );
        } else if ( req.query.filterWatched === 'exclude' ) {
            query = query.filter( { watched: false } );
        }

        return query;
    }

    getGenresQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( typeof req.query.filterGenres === 'object' ) {
            const genres = Object.keys( req.query.filterGenres );

            const included = genres.filter( genre => req.query.filterGenres[ genre ] === 'include' );
            const excluded = genres.filter( genre => req.query.filterGenres[ genre ] === 'exclude' );

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
        if ( typeof req.query.filterCollections === 'object' ) {
            const collections = Object.keys( req.query.filterCollections );

            const included = collections.filter( collection => req.query.filterCollections[ collection ] === 'include' );
            const excluded = collections.filter( collection => req.query.filterCollections[ collection ] === 'exclude' );

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

    @Route( 'get', '/:id/artwork' )
    async listArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const media : MediaRecord = await this.table.get( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }
        
        const url = this.server.getMatchingUrl( req );
        
        const images = await this.server.scrapers.getAllMediaArtork( media.kind, media.external );

        return images.map( image => ( {
            ...image,
            url: this.server.artwork.getCachedRemoteImage( url, image.url )
        } ) );
    }

    @Route( 'post', '/:id/artwork' )
    async setArtwork ( req : Request, res : Response ) {
        const property = req.body.property;
        const artwork = req.body.artwork;

        if ( !property ) {
            throw new InvalidArgumentError( `When setting a media artwork, the 'property' can't be empty.` );
        }

        const validProperties = [ 'poster', 'background', 'banner', 'thumbnail' ];

        if ( !validProperties.includes( property ) ) {
            throw new InvalidArgumentError( `Expected the 'property' field to be one of [${ validProperties.join( ', ' ) }].` );
        }

        if ( !artwork ) {
            throw new InvalidArgumentError( `When setting a media artwork, the 'url' can't be empty.` );
        }

        const media : MediaRecord = await this.table.get( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        await this.server.media.setArtwork( media, property, artwork );

        return media;
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