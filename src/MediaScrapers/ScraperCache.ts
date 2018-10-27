import writeFileSafe from 'safe-file-write';
import * as fs from 'mz/fs';
import { Semaphore } from 'data-semaphore';

export interface CacheOptions {
    readTtl ?: number;
    readCache ?: boolean;
    writeCache ?: boolean;
    writeTtl ?: number;
}

export interface CacheBlock<T> {
    key : string;
    value : T;
    ttl ?: number;
    createdAt : number;
    touchedAt : number;
}

export type CacheData<T> = { [ key : string ] : CacheBlock<T> };

export class Cache<T> {
    protected data : CacheData<T> = {};

    storage ?: CacheStorage<T>;

    defaultTtl : number = 1000 * 60 * 60 * 20 * 31;

    cloneOnRetrieval : boolean = false;
    
    autoSaveDelay : number = 0;

    protected autoSaveTimeout : NodeJS.Timer = null;

    clone<T> ( value : T ) : T {
        if ( value instanceof Promise ) {
            return value.then( value => this.clone( value ) ) as any;
        } else if ( value instanceof Array ) {
            return value.map( value => this.clone( value ) ) as any;
        } else if ( value instanceof Date ) {
            return new Date( value.getTime() ) as any;
        } else if ( value && typeof value === 'object' ) {
            const newValue : any = {};

            for ( let key of Object.keys( value ) ) newValue[ key ] = this.clone( value[ key ] );

            return newValue;
        } else {
            return value;
        }
    }

    getBlock ( key : string, options : CacheOptions = {} ) : CacheBlock<T> {
        if ( typeof options.readCache === 'boolean' && !options.readCache ) {
            return null;
        }

        const block = this.data[ key ];

        if ( !block ) {
            return null;
        }

        const requestedTtl = typeof options.readTtl === 'number' 
            ? Math.min( options.readTtl, block.ttl )
            : ( block.ttl == 0 ? Infinity : block.ttl );

        if ( block.createdAt + requestedTtl < Date.now() ) {
            return null;
        }

        return block;
    }

    has ( key : string, options : CacheOptions = {} ) : boolean {
        return this.getBlock( key, options ) != null;
    }

    get ( key : string, options : CacheOptions = {} ) : T {
        const block = this.getBlock( key, options );

        if ( !block ) {
            return null;
        }

        if ( !( 'writeCache' in options ) || options.writeCache ) {
            this.dataChanged( key, block );

            block.touchedAt = Date.now();
        }

        if ( this.cloneOnRetrieval ) {
            return this.clone( block.value );
        }

        return block.value;
    }

    set ( key : string, value : T, options : CacheOptions = {} ) : T {
        if ( typeof options.writeCache === 'boolean' && !options.writeCache ) {
            return value;
        }

        const ttl = typeof options.writeTtl === 'number'
            ? options.writeTtl
            : this.defaultTtl;

        const now = Date.now();

        let block = this.data[ key ];

        if ( !block ) {
            block = {
                key, value, ttl,
                createdAt: now,
                touchedAt: now
            };

            this.data[ key ] = block;
        } else {
            block.value = value;
            block.ttl = ttl;
            block.createdAt = now;
            block.touchedAt = now;
        }

        this.dataChanged( key, block );
        
        return value;
    }

    delete ( key : string ) : void {
        delete this.data[ key ];
        
        this.dataChanged( key, null );
    }
    
    protected dataChanged ( key : string, block : CacheBlock<T> ) : void {
        if ( this.autoSaveDelay > 0 && this.autoSaveTimeout == null ) {
            this.autoSaveTimeout = setTimeout( async () => {
                this.autoSaveTimeout = null;

                await this.save();
            }, this.autoSaveDelay );
        }
    }

    async load () {
        if ( this.storage ) {
            this.data = await this.storage.load();
        }
    }

    async save () {
        if ( this.storage ) {
            await this.storage.save( this.data );
        }
    }
}

export class CacheStorage<T> {
    filePath : string;
    
    fileSemaphore : Semaphore = new Semaphore( 1 );

    constructor ( filePath : string ) {
        this.filePath = filePath;
    }

    async load () : Promise<CacheData<T>> {
        return this.fileSemaphore.use( 
            async () => {
                if ( await fs.exists( this.filePath ) ) {
                    return JSON.parse( await fs.readFile( this.filePath, { encoding: 'utf8' } ) ) 
                }

                return {};
            }
        );
    }

    async save ( data : CacheData<T> ) : Promise<void> {
        await this.fileSemaphore.use( 
            () => writeFileSafe( this.filePath, JSON.stringify( data ) ) 
        );
    }
}

export class AsyncCache<T> {
    executing : Cache<Promise<T>> = new Cache();

    results : Cache<T> = new Cache();

    get cloneOnRetrieval () : boolean {
        return this.results.cloneOnRetrieval;
    }

    set cloneOnRetrieval ( value : boolean ) {
        this.results.cloneOnRetrieval = value;
    }

    get autoSaveDelay () : number {
        return this.results.autoSaveDelay;
    }

    set autoSaveDelay ( delay : number ) {
        this.results.autoSaveDelay = delay;
    }

    get storage () : CacheStorage<T> {
        return this.results.storage;
    }

    set storage ( value : CacheStorage<T> ) {
        this.results.storage = value;
    }

    async load () {
        return this.results.load();
    }

    async save () {
        return this.results.save();
    }

    has ( key : string, options : CacheOptions = {} ) : boolean {
        return this.executing.has( key, options ) || this.results.has( key, options );
    }

    get<T2 extends T> ( key : string, options : CacheOptions = {} ) : Promise<T2> {
        const executing = this.executing.get( key, options );

        if ( executing != null ) {
            if ( this.results.cloneOnRetrieval ) {
                return this.executing.clone( executing as Promise<T2> );
            }

            return executing as Promise<T2>;
        }

        const stored = this.results.get( key, options );

        if ( stored ) {
            return Promise.resolve( stored as T2 );
        }

        return null;
    }

    async set<T2 extends T> ( key : string, value : Promise<T2>, options : CacheOptions = {} ) : Promise<T2> {
        if ( typeof options.writeCache === 'boolean' && !options.writeCache ) {
            return value;
        }

        this.executing.set( key, value, options );
        
        try {
            const valueSync = await value;

            this.results.set( key, valueSync, options );

            return valueSync;
        } catch ( err ) {
            throw err;
        } finally {
            this.executing.delete( key );
        }
    }

    delete ( key : string ) : void {
        this.executing.delete( key );
        this.results.delete( key );
    }
}