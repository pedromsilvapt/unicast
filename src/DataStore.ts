import { StorageTable, StorageRecord } from './Database/Database';
import { UnicastServer } from './UnicastServer';
import * as r from 'rethinkdb';
import { SemaphorePool } from 'data-semaphore';

function escapeRegExp ( string ) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

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

    protected async getStorageRecord<V = any> ( key : string, query ?: (query: r.Sequence) => r.Sequence ) : Promise<StorageRecord<V>> {
        const results = await this.table.findAll( [ key ], { index: 'key', query } );

        if ( results.length == 0 ) {
            return null;
        }

        return results[ 0 ];
    }

    async list ( options : DataStoreListOptions = {} ) : Promise<StorageRecord[]> {
        let query : ( query : r.Sequence ) => r.Sequence;

        if ( options.prefix ) {
            query = q => q.filter( ( r.row( 'key' ) as any ).match("^" + escapeRegExp( options.prefix ) ) );
        }

        if ( options.tags && options.tags.length > 0 ) {
            return await this.table.findAll( options.tags, { index: 'tags', query: query } );
        } else {
            return await this.table.find( query );
        }
    }

    async get<V = any> ( key : string, query ?: (query: r.Sequence) => r.Sequence ) : Promise<StorageRecord<V>> {
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
                value: ( r as any ).literal( value ),
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
    
            // Create a copy object with only the "indexBy" keys
            const indexQuery: Partial<T> = {};
            for ( const indexKey of indexBy ) {
                indexQuery[ indexKey ] = object[ indexKey ];
            }
    
            // See if there is any record for this key on the datastore
            const record = await this.get<T[]>( key, query => query.map( row => ( {
                id: row( 'id' ),
                value: ( row( 'value' ) as any ).coerceTo('array').filter( indexQuery ),
            } ) as any ) );
    
            if ( record == null ) {
                await this.store( key, [ object ] );
    
                return true;
            } else {
                if ( record.value.length == 0 ) {
                    await this.table.update( record.id, {
                        value: r.row( 'value' ).append( object as any ),
                        updatedAt: now,
                    } );
    
                    return true;
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

            // Create a copy object with only the "indexBy" keys
            const indexQuery: Partial<T> = {};
            for ( const indexKey of indexBy ) {
                indexQuery[ indexKey ] = object[ indexKey ];
            }

            // See if there is any record for this key on the datastore
            const record = await this.get<T[]>( key, query => query.map( row => ( {
                id: row( 'id' ),
                value: ( row( 'value' ) as any ).coerceTo('array').filter( indexQuery ),
            } ) as any ) );

            // If no key exists, great, nothing to remove
            if ( record == null ) {
                return false;
            } else {
                // If the set exists but does not contain the object, great, nothing to remove
                if ( record.value.length == 0 ) {
                    return false;
                } else {
                    await this.table.update( record.id, {
                        value: ( r.row( 'value' ) as any ).filter( item => {
                            let query: any = null;

                            for ( const indexKey of indexBy ) {
                                if ( query == null ) {
                                    query = item( indexKey ).ne( object[ indexKey ] );
                                } else {
                                    query = query.and( item( indexKey ).ne( object[ indexKey ] ) );
                                }
                            }

                            return query;
                        } ).coerceTo( 'array' ),
                        updatedAt: now,
                    } );

                    return true;
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
