import { BaseTableController, RequestQuery } from "../../BaseTableController";
import { Request, Response } from "restify";
import * as r from 'rethinkdb';
import { MediaRecord, ArtRecord, isPlayableRecord, PersonRecord } from "../../../MediaRecord";
import { Route } from "../../BaseController";
import { MediaTrigger } from "../../../TriggerDb";
import { MediaTable } from "../../../Database/Database";
import { ResourceNotFoundError, InvalidArgumentError } from 'restify-errors';
import { MediaRecordQuerySemantics, QueryAst, QueryLang, QuerySemantics } from '../../../QueryLang';

export abstract class MediaTableController<R extends MediaRecord, T extends MediaTable<R> = MediaTable<R>> extends BaseTableController<R, T> {
    createCustomQuerySemantics ( req: Request, ast : QueryAst ) : QuerySemantics<R> {
        const semantics = new MediaRecordQuerySemantics();

        semantics.features.collection = QueryLang.hasIdentifier( ast, 'collection' );

        semantics.features.cast = QueryLang.hasIdentifier( ast, 'cast' );

        semantics.features.repository = QueryLang.hasIdentifier( ast, 'repository' );

        semantics.features.genre = QueryLang.hasIdentifier( ast, 'genre' );

        return semantics;
    }

    async runCustomQuery ( req: Request, records: R[] ) : Promise<R[]> {
        const query: RequestQuery<R> = req.query;

        const semantics = query?.search?.embeddedQuerySemantics as MediaRecordQuerySemantics<R>;

        if ( semantics != null ) {
            if ( semantics.features.collection ) {
                await this.table.relations.collections.applyAll( records );
            }
            
            if ( semantics.features.cast ) {
                await this.table.relations.cast.applyAll( records );
            }
        }
        
        await this.table.relations.collections.applyAll( records );

        return super.runCustomQuery( req, records );
    }

    getQueryCustomOrder ( query: r.Sequence, field: string, direction: 'asc' |  'desc', list: string ) : r.Sequence {
        if ( field === '$userRank' ) {
            const userRanksTable = this.server.database.tables.userRanks;
            
            const kind = this.server.media.getKind( this.table );

            let itemsInListQuery: r.Sequence = userRanksTable.query();

            // Direction in intentionally reversed because for user ranks, by convention, we
            // decided that the first is the one with the bigger $userRank
            if ( direction === 'desc' ) {
                itemsInListQuery = itemsInListQuery.orderBy( { index: r.asc( 'position' ) } );
            } else {
                itemsInListQuery = itemsInListQuery.orderBy( { index: r.desc( 'position' ) } );
            }

            itemsInListQuery = itemsInListQuery
                .filter( { list, reference: { kind } } )
                // Join the media records
                .concatMap( userRank => { 
                    return this.table.query()
                          .getAll( userRank('reference')('id') )
                          .map( media => media.merge( { $userRank: userRank('position') } as any ) as any ) as any;
                } );

            let itemsNotInListQuery = query.orderBy( { index: this.defaultSortField } ).concatMap( media => {
                return (userRanksTable.query()
                    .getAll( [ kind, media("id") ] as any, { index: "reference" } )
                    .filter( { list } ) as any )
                    .isEmpty().branch(
                        [ media.merge( { $userRank: 0 } as any ) ] as any,
                        []
                    );
            } );

            // Direction reversed here too, same reason as above
            const interleave = direction === 'desc' ? r.asc( '$userRank' ) : r.desc( '$userRank' );
            
            return ( itemsInListQuery.union as any )( itemsNotInListQuery, { interleave } );
        }
    }

    getTransientQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( req.query.transient == 'include' ) {
            return ( query.filter as any )( doc => doc( 'transient' ).eq( true ), { default: true } );
        } else if ( req.query.transient == 'exclude' || !req.query.transient ) {
            return ( query.filter as any )( doc => doc( 'transient' ).eq( false ), { default: true } );
        } else {
            return query;
        }
    }

    getWatchedQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( req.query.filterWatched === 'include' ) {
            query = query.filter( { watched: true } );
        } else if ( req.query.filterWatched === 'exclude' ) {
            query = query.filter( { watched: false } );
        }

        return query;
    }

    getRepositoryPathsQuery ( req : Request, query : r.Sequence ) : r.Sequence {
        if ( typeof req.query.filterRepositories === 'object' ) {
            const repos = Object.keys( req.query.filterRepositories );

            const included = repos.filter( genre => req.query.filterRepositories[ genre ] === 'include' );
            const excluded = repos.filter( genre => req.query.filterRepositories[ genre ] === 'exclude' );

            if ( included.length > 0 || excluded.length > 0 ) {
                query = query.filter( ( doc ) => {
                    if ( included.length > 0 && excluded.length > 0 ) {
                        return ( doc( "repositoryPaths" ) as any ).setIntersection( included ).isEmpty().not().and(
                            ( doc( "repositoryPaths" ) as any ).setIntersection( excluded ).isEmpty()
                        );
                    } else if ( included.length > 0 ) {
                        return ( doc( "repositoryPaths" ) as any ).setIntersection( included ).isEmpty().not();
                    } else if ( excluded.length > 0 ) {
                        return ( doc( "repositoryPaths" ) as any ).setIntersection( excluded ).isEmpty();
                    }
                } );
            }
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
        
        if ( req.query.sample ) {
            query = query.sample( +req.query.sample );
        }

        return query;
    }

    async transformAll ( req : Request, res : Response, records : R[] ) : Promise<any> {
        records = await super.transformAll( req, res, records );

        if ( req.query.cast == 'true' ) {
            await this.table.relations.cast.applyAll( records );

            const url = this.server.getMatchingUrl( req );

            for ( let record of records ) {
                for ( let person of ( record as any ).cast ) {
                    ( person as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, record.art );
                }
            }
        }

        return records;
    }

    @Route( 'get', '/:id/artwork' )
    async listArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const media : MediaRecord = await this.table.get( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const url = this.server.getMatchingUrl( req );
        
        const images = await this.server.scrapers.getAllMediaArtork( media.kind, media.external, {}, { readCache: false } );

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
        
        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }
        
        const triggers = await this.server.triggerdb.queryMediaRecord( media );

        return triggers;
    }

    @Route('get', '/:id/streams')
    async streams ( req : Request, res : Response ) {
        const media = await this.table.get( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }
        
        if ( !isPlayableRecord( media ) ) {
            throw new InvalidArgumentError( 'Media is not playable.' );
        }

        const streams = await this.server.providers.streams( media.sources );

        return streams.map( s => ( {
            ...s.toJSON(),
            path: this.server.streams.getUrlFor( media.kind, media.id, s.id )
        } ) );
    }

    @Route('get', '/:id/collections')
    async collections ( req : Request, res : Response ) {
        const kind = this.server.media.getKind( this.table );

        return await this.server.media.getCollections( kind, req.params.id );
    }

    @Route( 'get', '/:id/cast' )
    async cast ( req : Request, res : Response ) : Promise<PersonRecord[]> {
        const media : MediaRecord = await this.table.get( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }
        
        const cast = await this.server.media.getCast( media );

        const url = this.server.getMatchingUrl( req );

        for ( let record of cast ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, record.art );
        }

        return cast;
    }

    @Route( 'post', '/:id/watch/:status' )
    async watch ( req : Request, res : Response ) : Promise<R> {
        const media = await this.table.get( req.params.id );

        const watched : boolean = req.params.status === 'true';
        
        await this.server.media.watchTracker.watch( media, watched );

        return this.table.get( req.params.id );
    }
}