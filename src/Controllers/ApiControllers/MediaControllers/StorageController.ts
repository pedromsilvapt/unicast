import { BaseController, Route, ValidateBody } from "../../BaseController";
import { Request, Response } from "restify";
import { StorageRecord } from '../../../Database/Database';
import * as schema from '@gallant/schema';

export class StorageController extends BaseController {
    @Route( 'get', '' )
    async list ( req : Request, res : Response ) : Promise<StorageRecord[]> {
        return await this.server.dataStore.list( { prefix: req.query.prefix } );
    }

    @Route( 'get', '/:key' )
    async get ( req : Request, res : Response ) : Promise<StorageRecord> {
        const record = await this.server.dataStore.get( req.params.key );

        if ( record == null ) {
            // 404 Not Found
            return null;
        }

        return record;
    }

    @Route( 'post', '/:key' )
    async store ( req : Request, res : Response ) : Promise<StorageRecord> {
        return await this.server.dataStore.store( req.params.key, req.body );
    }

    @Route( 'del', '/:key' )
    async delete ( req : Request, res : Response ) : Promise<boolean> {
        return await this.server.dataStore.delete( req.params.key );
    }

    @ValidateBody( schema.parse( `{
        object: object;
        primaryKeys?: string[];
    }` ) )
    @Route( 'post', '/:key/add-to-set' )
    async addToSet ( req : Request, res : Response ) : Promise<{changed: boolean}> {
        const key = req.params.key;
        const object: object = req.body.object;
        let primaryKeys = req.body.primaryKeys;
        
        if ( primaryKeys == null || primaryKeys.length == 0 ) {
            primaryKeys = Object.keys( object );
        }

        const changed = await this.server.dataStore.addToSet( key, primaryKeys, object );

        return { changed };
    }

    @ValidateBody( schema.parse( `{
        object: object;
        primaryKeys?: string[];
    }` ) )
    @Route( 'post', '/:key/delete-from-set' )
    async removeFromSet ( req : Request, res : Response ) : Promise<{changed: boolean}> {
        const key: string = req.params.key;
        const object: any = req.body.object;
        let primaryKeys: string[] = req.body.primaryKeys;

        if ( primaryKeys == null || primaryKeys.length == 0 ) {
            primaryKeys = Object.keys( object );
        }
        
        const changed = await this.server.dataStore.deleteFromSet( key, primaryKeys, object );

        return { changed };
    }
}