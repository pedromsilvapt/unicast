import { ResourceNotFoundError, InvalidArgumentError } from "restify-errors";
import { PlaylistRecord, BaseTable } from "../../Database/Database";
import { BaseTableController } from "../BaseTableController";
import { Request, Response } from "restify";
import { Route } from "../BaseController";
import * as r from 'rethinkdb';
import { MediaRecord } from "../../MediaRecord";
import { MediaSourceLike } from "../../MediaProviders/ProvidersManager";

export class PlaylistsController extends BaseTableController<PlaylistRecord> {
    defaultSortField : string = 'createdAt';

    sortingFields : string[] = [ 'createdAt', 'updatedAt' ];

    searchFields : string[] = [];

    get table () : BaseTable<PlaylistRecord> {
        return this.server.database.tables.playlists;
    }

    async transformDocument ( req : Request, res : Response, playlist : any, isNew : boolean ) : Promise<any> {
        playlist = {
            ...playlist,
            device: req.params.device,
            updatedAt: new Date()
        };

        if ( isNew ) {
            playlist.createdAt = new Date();
            playlist.references = playlist.references || [];
        } else {
            delete playlist.createdAt;
        }

        delete playlist.items;

        return playlist;
    }

    async applyPlaylistsItems ( req : Request, playlists : PlaylistRecord[] ) : Promise<void> {
        await this.server.database.tables.playlists.relations.items.applyAll( playlists );

        const member = this.server.database.tables.playlists.relations.items.member;
        
        const url = this.server.getMatchingUrl( req );

        let inconsistent = false;
        
        for ( let playlist of playlists ) {
            inconsistent = false;

            for ( let item of playlist[ member ] ) {
                // Sometimes the playlist data might be invalid (for some reason, one of it's items is missing or something)
                // And so trying to get the properties (kind, id, art, etc...) for an undefined value would throw an error
                // And in turn would prevent the requests from being successful because of that one missing item
                // So we just skip them
                if ( !item ) {
                    inconsistent = true;

                    continue;
                }

                ( item as any ).cachedArtwork = this.server.artwork.getCachedObject( url, item.kind, item.id, item.art );            
            }

            // And as a courtesy to the frontend, we also omit the undefined values from the items list if there are any
            // The if guards against creating arrays when filtering for every single playlist, when 99% of them are probably consistent anyway
            if ( inconsistent ) {
                playlist[ member ] = playlist[ member ].filter( item => !!item );                
            }
        }
    }

    async getPlaylistItems ( req : Request, playlist : PlaylistRecord ) : Promise<MediaRecord[]> {
        await this.applyPlaylistsItems( req, [ playlist ] );

        const member = this.server.database.tables.playlists.relations.items.member;

        return playlist[ member ];
    }

    async transformAll ( req : Request, res : Response, playlists : PlaylistRecord[] ) {
        if ( req.query.items === 'true' ) {
            await this.server.database.tables.playlists.relations.items.applyAll( playlists );
        }

        return playlists;
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        return super.getQuery( req, res, query ).filter( { device: req.params.device } );
    }

    @Route( 'get', '/last' )
    async last ( req : Request, res : Response ) {
        const playlists = await this.table.find( query => {
            query = query.orderBy( { index: r.desc( 'createdAt' ) } ).filter( { device: req.params.device } );

            if ( req.query.empty === 'exclude' ) {
                query.filter( doc => ( doc as any )( 'references' ).count().gt( 0 ) )
            } else if ( req.query.empty === 'include' ) {
                query.filter( doc => ( doc as any )( 'references' ).count().lt( 0 ) )
            }

            return query.limit( 1 );
        } );

        if ( !playlists.length ) {
            return null;
        }

        return this.transform( req, res, playlists[ 0 ] );
    }

    @Route( 'get', '/:id/items' )
    async getItems ( req : Request, res : Response ) : Promise<MediaRecord[]> {
        const playlist = await this.table.get( req.params.id );

        if ( !playlist ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        return await this.getPlaylistItems( req, playlist );
    }

    @Route( 'post', '/:id/items' )
    async storeItems ( req : Request, res : Response ) {
        let playlist = await this.table.get( req.params.id );

        if ( !playlist ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const references = typeof req.body === 'string' ? JSON.parse( req.body ) : req.body;

        if ( !( references instanceof Array ) ) {
            throw new InvalidArgumentError( `The request body must be an array.` );
        }

        for ( let [ index, item ] of references.entries() ) {
            if ( !item.id && item.sources ) {
                const sources : MediaSourceLike = item.sources;

                const record = await this.server.media.createFromSources( sources );

                references[ index ] = { kind: record.kind, id: record.id };
            } else {
                if ( typeof item !== 'object' || typeof item.kind !== 'string' || typeof item.id !== 'string' || !item.kind || !item.id ) {
                    throw new InvalidArgumentError( `Array's elements must be objects with the string properties "kind" and "id".` );
                }
            }
        }

        playlist = await this.table.update( playlist.id, {
            references: references,
            updatedAt: new Date()
        } );

        return await Promise.all( playlist.references.map( ( { kind, id } ) => this.server.media.get( kind, id ) ) );
    }
}