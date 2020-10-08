import { StorageTable, StorageRecord } from './Database/Database';
import { UnicastServer } from './UnicastServer';
import * as r from 'rethinkdb';

function escapeRegExp ( string ) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export class DataStore {
    server : UnicastServer;

    get table () : StorageTable {
        return this.server.database.tables.storage;
    }

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    protected async getStorageRecord ( key : string ) : Promise<StorageRecord> {
        const results = await this.table.findAll( [ key ], { index: 'key' } );

        if ( results.length == 0 ) {
            return null;
        }

        return results[ 0 ];
    }

    async list ( options : DataStoreListOptions = {} ) : Promise<StorageRecord[]> {
        let query : ( query : r.Sequence ) => r.Sequence;

        if ( options.prefix ) {
            query = q => q.filter( r.row( 'key' ).match("^" + escapeRegExp( options.prefix ) ) );
        }

        if ( options.tags && options.tags.length > 0 ) {
            return await this.table.findAll( options.tags, { index: 'tags', query: query } );
        } else {
            return await this.table.find( query );
        }
    }

    async get ( key : string ) : Promise<StorageRecord> {
        return await this.getStorageRecord( key );
    }

    async store<T> ( key : string, value : T, autoTag : boolean = false, tags : string[] = void 0 ) : Promise<StorageRecord<T>> {
        const now = new Date();
        
        const record = await this.getStorageRecord( key );
        
        if ( record == null ) {
            if ( !tags ) {
                tags = [];
            }

            if ( autoTag ) {
                tags = tags.concat( key.split( '.' ).slice( 0, -1 ) );
            }

            return await this.table.create( {
                key: key,
                value: value,
                tags: tags,
                createdAt: now,
                updatedAt: now
            } );
        } else {
            return await this.table.update( record.id, {
                value: r.literal( value ),
                updatedAt: now,
                ...( tags ? { tags } : {} )
            } );
        }
    }

    async retag<T> ( key : string, tags : string[] = [] ) : Promise<StorageRecord<T>> {
        const now = new Date();
        
        const record = await this.getStorageRecord( key );

        if ( record != null ) {
            return await this.table.update( record.id, {
                tags: tags,
                updatedAt: now
            } );
        } else {
            throw new Error( `Could not find key ${ key }` );
        }
    }

    async deleteMany ( options : DataStoreListOptions ) : Promise<string[]> {
        const records = await this.list( options );

        if ( records.length > 0 ) {
            await this.server.database.tables.storage.deleteKeys( [ records.map( r => r.id ) ] );
        }

        return records.map( r => r.key );
    }

    async delete ( key : string ) : Promise<boolean> {
        const record = await this.getStorageRecord( key );

        if ( record != null ) {
            return await this.server.database.tables.storage.delete( record.id );
        }

        return false;
    }
}

export interface DataStoreListOptions {
    prefix ?: string;
    tags ?: string[];
}
