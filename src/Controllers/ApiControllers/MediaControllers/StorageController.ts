import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { StorageRecord } from '../../../Database/Database';

export class StorageController extends BaseController {
    protected async getStorageRecord ( key : string ) : Promise<StorageRecord> {
        const results = await this.server.database.tables.storage.findAll( [ key ], { index: 'key' } );

        if ( results.length == 0 ) {
            return null;
        }

        return results[ 0 ];
    }

    @Route( 'get', '' )
    async list ( req : Request, res : Response ) : Promise<any> {
        return await this.server.database.tables.storage.find();
    }

    @Route( 'get', '/:key' )
    async get ( req : Request, res : Response ) : Promise<any> {
        const record = await this.getStorageRecord( req.params.key );

        if ( record == null ) {
            // 404 Not Found
            return null;
        }

        return record;
    }

    @Route( 'post', '/:key' )
    async store ( req : Request, res : Response ) : Promise<any> {
        const now = new Date();

        const key = req.params.key;
        
        const record = await this.getStorageRecord( key );

        if ( record == null ) {
            await this.server.database.tables.storage.create( {
                key: key,
                value: req.body,
                createdAt: now,
                updatedAt: now
            } );
        } else {
            await this.server.database.tables.storage.update( record.id, {
                value: req.body,
                updatedAt: now
            } );
        }
    }

    @Route( 'del', '/:key' )
    async delete ( req : Request, res : Response ) : Promise<any> {
        const record = await this.getStorageRecord( req.params.key );

        if ( record == null ) {
            // 404 Not Found
            return null;
        }

        await this.server.database.tables.storage.delete( record.id );
    }
}