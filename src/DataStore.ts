import { StorageTable, StorageRecord } from './Database/Database';
import { UnicastServer } from './UnicastServer';
import { SemaphorePool } from 'data-semaphore';
import { Knex } from 'knex';

export class DataStore {
    server : UnicastServer;

    semaphore : SemaphorePool<string>;

    get table () : StorageTable {
        return this.server.database.tables.storage;
    }

    constructor ( server : UnicastServer ) {
        this.server = server;
        this.semaphore = new SemaphorePool( 1, true );
    }

    protected async getStorageRecord<V = any> ( key : string, query ?: (query: Knex.QueryBuilder) => Knex.QueryBuilder ) : Promise<StorageRecord<V>> {
        return query
            ? await this.table.findOne( q => query( q.where( 'key', key ) ) )
            : await this.table.findOne( q => q.where( 'key', key ) );
    }

    async list ( options : DataStoreListOptions = {} ) : Promise<StorageRecord[]> {
        return await this.table.find( q => {
            if ( options.prefix ) {
                q = q.whereLike( 'key',  options.prefix + '%' );
            }
            if ( options.tags && options.tags.length > 0 ) {
                q = q.whereExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.tags)` ).whereIn( 'value', options.tags ) );
            }
            
            return q;
        } );
    }

    async get<V = any> ( key : string, query ?: (query: Knex.QueryBuilder) => Knex.QueryBuilder ) : Promise<StorageRecord<V>> {
        return await this.getStorageRecord<V>( key, query );
    }

    async store<T> ( key : string, value : T, autoTag : boolean = false, tags : string[] = void 0 ) : Promise<StorageRecord<T>> {
        const now = new Date();
        
        const record = await this.getStorageRecord<T>( key );
        
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
                value: value,
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

    async addToSet<T extends object> ( key : string, indexBy: (keyof T)[], object: T ): Promise<boolean> {
        await this.semaphore.acquire( key );

        try {
            const now = new Date();
    
            // Create a predicate function for the indexed keys
            const indexQuery : (obj : T) => boolean = obj => {
                for ( const indexKey of indexBy ) {
                    if ( obj[ indexKey ] != object[ indexKey ] ) {
                        return false;
                    }
                }
                
                return true;
            };
    
            // See if there is any record for this key on the datastore
            const record = await this.get<T[]>( key );
    
            if ( record == null ) {
                await this.store( key, [ object ] );
    
                return true;
            } else {
                if ( record.value.length == 0 ) {
                    const elementIndex = record.value.findIndex( obj => indexQuery( obj ) );
                    
                    if ( elementIndex <= 0 ) {
                        record.value.push( object );
                        
                        await this.table.update( record.id, { value: record.value, updatedAt: now } );
                        
                        return true;
                    }
                    
                    return false;
                } else {
                    return false;
                }
            }
        } finally {
            this.semaphore.release( key );
        }
    }

    async deleteFromSet<T extends object> ( key: string, indexBy: (keyof T)[], object: T ) : Promise<boolean> {
        await this.semaphore.acquire( key );

        try {
            const now = new Date();

            // Create a predicate function for the indexed keys
            const indexQuery : (obj : T) => boolean = obj => {
                for ( const indexKey of indexBy ) {
                    if ( obj[ indexKey ] != object[ indexKey ] ) {
                        return false;
                    }
                }
                
                return true;
            };
            
            // See if there is any record for this key on the datastore
            // const record = await this.get<StorageRecord<T[]>>( key )
            const record = await this.get<T[]>( key );

            // If no key exists, great, nothing to remove
            if ( record == null ) {
                return false;
            } else {
                // If the set is empty, great, nothing to remove
                if ( record.value.length == 0 ) {
                    return false;
                } else {
                    const newValue = record.value.filter( obj => !indexQuery( obj ) );
                    
                    if ( newValue.length != record.value.length ) {
                        await this.table.update( record.id, { value: newValue, updatedAt: now } );
                        
                        return true;
                    }
                    
                    return false;
                }
            }
        } finally {
            this.semaphore.release( key );
        }
    }
}

export interface DataStoreListOptions {
    prefix ?: string;
    tags ?: string[];
}
