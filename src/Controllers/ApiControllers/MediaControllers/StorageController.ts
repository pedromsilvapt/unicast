import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { StorageRecord } from '../../../Database/Database';

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
}