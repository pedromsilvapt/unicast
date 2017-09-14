import { BaseController, RoutesDeclarations, Route } from "./BaseController";
import { BaseTable } from "../Database";
import { Response, Request } from "restify";
import { ResourceNotFoundError, NotAuthorizedError, InvalidArgumentError } from "restify-errors";
import * as regexEscape from 'regex-escape';
import * as r from 'rethinkdb';

export abstract class BaseTableController<R> extends BaseController {
    abstract readonly table : BaseTable<R>;

    defaultSortField : string = 'title';

    sortingFields : string[] = [ 'title' ];

    searchFields : string[] = [ 'title' ];

    allowedActions : string[] = [ 'list', 'get', 'create', 'update', 'delete' ];

    getSearchQuery ( search : string, query : r.Sequence ) : r.Sequence {
        if ( this.searchFields.length === 0 ) {
            return query;
        }

        const regex = '(?i)' + regexEscape( search );

        return query.filter( doc => {
            let conditional = doc;

            for ( let [ index, field ] of this.searchFields.entries() ) {
                if ( index === 0 ) {
                    conditional = doc( field ).match( regex );
                } else {
                    conditional = conditional.or( doc( field ).match( regex ) );
                }
            }

            return conditional;
        } );
    }

    getQuery ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        if ( req.query.sort ) {
            if ( !this.sortingFields.includes( req.query.sort ) ) {
                throw new InvalidArgumentError( `Invalid sort field "${ req.query.sort }" requested.` );
            }

            query = query.orderBy( { index: req.query.sort } );
        } else if ( this.defaultSortField ) {
            query = query.orderBy( { index: this.defaultSortField } );
        }

        if ( req.query.search ) {
            query = this.getSearchQuery( req.query.search, query );
        }

        return query;
    }

    getPagination ( req : Request, res : Response, query : r.Sequence ) : r.Sequence {
        if ( req.query.skip ) {
            query = query.skip( +req.query.skip );
        }

        if ( req.query.take ) {
            query = query.limit( +req.query.take );
        }

        return query;
    }

    async transformQuery ( req : Request ) : Promise<void> {};

    async transform ( req : Request, res : Response, item : R ) : Promise<any> {
        return item;
    }

    @Route( 'get', '/' )
    async list ( req : Request, res : Response ) : Promise<R[]> {
        if ( !this.allowedActions.includes( 'list' ) ) {
            throw new NotAuthorizedError();
        }

        await this.transformQuery( req );

        const list = await this.table.find( query => this.getPagination( req, res, this.getQuery( req, res, query ) ) );

        return Promise.all( list.map( item => this.transform( req, res, item ) ) );
    }

    @Route( 'get', '/:id', null, true )
    async get ( req : Request, res : Response ) : Promise<R> {
        if ( !this.allowedActions.includes( 'get' ) ) {
            throw new NotAuthorizedError();
        }

        const item : R = await this.table.get( req.params.id );

        if ( !item ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        return this.transform( req, res, item );
    }

    @Route( 'post', '/' )
    async create ( req : Request, res : Response ) : Promise<R> {
        if ( !this.allowedActions.includes( 'create' ) ) {
            throw new NotAuthorizedError();
        }

        const body = req.body;

        const item : R = await this.table.create( body );

        if ( !item ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${req.params.id}".` );
        }

        return this.transform( req, res, item );
    }

    @Route( 'post', '/:id', null, true )
    async update ( req : Request, res : Response ) : Promise<R> {
        if ( !this.allowedActions.includes( 'update' ) ) {
            throw new NotAuthorizedError();
        }

        const body = req.body;

        const item : R = await this.table.update( req.params.id, body );

        if ( !item ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        return this.transform( req, res, item );
    }
}