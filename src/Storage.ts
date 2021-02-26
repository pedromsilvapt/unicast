import { UnicastServer } from "./UnicastServer";
import * as uid from 'uid';
import * as fs from 'mz/fs';
import * as path from 'path';
import { Singleton } from "./ES2017/Singleton";
import { Semaphore } from "data-semaphore";
import { isBefore, subDays } from 'date-fns';

export class Storage {
    server : UnicastServer;

    cleaner : StorageCleaner;

    randomNameLength : number = 15;

    containers : StorageCacheContainer[] = [];

    protected cleaningSemaphore : Semaphore = new Semaphore( 1 );

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.cleaner = new StorageCleaner( this );

        this.server.onClose.subscribe( async () => {
            await this.clean();
        } );
    }

    createContainer ( path : string, predicate ?: StoragePredicate ) {
        const container = new StorageCacheContainer( this, path, predicate );

        this.containers.push( container );

        return container;
    }

    @Singleton( ( folder ) => folder )
    async ensureDir ( folder : string ) : Promise<void> {
        if ( !( await fs.exists( folder ) ) ) {
            await this.ensureDir( path.dirname( folder ) );

            await fs.mkdir( folder );
        }
    }

    getPath ( ...file : string[] ) : string {
        const storagePath = this.server.config.get( 'storage', 'storage' );

        return path.resolve( path.join( storagePath, ...file ) );
    }

    async getRandomFolder ( prefix : string = null, container : string = 'temp/folders' ) : Promise<string> {
        const release = await this.cleaningSemaphore.acquire();

        try {
            const random = uid( this.randomNameLength );
    
            const folder = this.getPath( 
                container, 
                ( prefix ? ( prefix + '' ) : '' ) + random
            );
            
            await this.ensureDir( folder );
    
            return folder;
        } finally {
            release();
        }
    }

    async getRandomFile ( prefix : string, extension : string = null, container : string = 'temp/files' ) {
        const release = await this.cleaningSemaphore.acquire();

        try {
            const random = uid( this.randomNameLength );
    
            const file = this.getPath(
                container,
                ( prefix ? ( prefix + '' ) : '' ) + random + ( extension ? ( '.' + extension ) : '' )            
            );
    
            await this.ensureDir( path.dirname( file ) );

            return file;
        } finally {
            release();
        }
    }

    async clean () {
        const release = await this.cleaningSemaphore.acquire();

        await this.cleaner.clean( 'temp', 
            this.cleaner.or( 
                stats => stats.isDirectory(),
                this.cleaner.olderThan( subDays( new Date(), 1 )
            ) )
        );

        for ( let container of this.containers ) {
            await container.clean();
        }

        release();
    }
}

export type StoragePredicate = ( stats : fs.Stats, file : string ) => boolean | Promise<boolean>;

export class StorageCleaner {
    storage : Storage;
    
    semaphore : Semaphore = new Semaphore( 1 );

    constructor ( storage : Storage ) {
        this.storage = storage;
    }

    olderThan ( days : Date ) : StoragePredicate {
        return ( stats, file ) => {
            return isBefore( stats.atime, days );
        };
    }

    and ( ...predicates : StoragePredicate[] ) : StoragePredicate {
        return async ( stats, file ) => {
            for ( let predicate of predicates ) {
                if ( !await predicate( stats, file ) ) {
                    return false;
                }
            }

            return true;
        }
    }

    or ( ...predicates : StoragePredicate[] ) : StoragePredicate {
        return async ( stats, file ) => {
            for ( let predicate of predicates ) {
                if ( await predicate( stats, file ) ) {
                    return true;
                }
            }

            return false;
        }
    }

    async clean ( target : string, condition ?: StoragePredicate ) : Promise<void> {
        target = this.storage.getPath( target );

        condition = condition || ( () => true );

        const release = await this.semaphore.acquire();

        try {
            if ( await fs.exists( target ) ) {
                const stats = await fs.stat( target );
    
                if ( stats.isFile() ) {
                    await this.cleanFile( stats, target, condition );
                } else {
                    await this.cleanFolder( stats, target, condition, false );
                }
            }
        } catch ( error ) {
            await this.storage.server.onError.notify( error );
        } finally {
            release();
        }
    }

    protected async cleanFile ( stats : fs.Stats, target : string, condition : StoragePredicate ) : Promise<boolean> {
        if ( await condition( stats, target ) ) {
            await fs.unlink( target );
            
            return true;
        }

        return false;
    }

    protected async cleanFolder ( stats : fs.Stats, target : string, condition : StoragePredicate, cleanSelf : boolean = true ) {        
        if ( await condition( stats, target ) ) {
            const files = await fs.readdir( target );

            let count : number = 0;

            for ( let file of files ) {
                const fileStats = await fs.stat( path.join( target, file ) );

                if ( fileStats.isFile() ) {
                    try {
                        if ( await this.cleanFile( fileStats, path.join( target, file ), condition ) ) {
                            count += 1;
                        }
                    } catch ( error ) {
                        await this.storage.server.onError.notify( error );
                    }
                } else {
                    try {
                        if ( await this.cleanFolder( fileStats, path.join( target, file ), condition ) ) {
                            count += 1;
                        }
                    } catch ( error ) {
                        await this.storage.server.onError.notify( error );
                    }
                }
            }

            if ( files.length === count ) {
                await fs.rmdir( target );
                
                return true;
            }
        }

        return false;
    }
}

export class StorageCacheContainer {
    storage : Storage;
    
    folder : string;

    predicate : StoragePredicate;
    
    constructor ( storage, folder : string, predicate : StoragePredicate ) {
        this.storage = storage;
        this.folder = folder;
        this.predicate = predicate || ( () => false );
    }

    
    getPath ( ...file : string[] ) : string {
        return this.storage.getPath( this.folder, ...file );
    }

    async getRandomFolder ( prefix : string = null ) : Promise<string> {
        return this.storage.getRandomFolder( prefix, this.folder );
    }

    async getRandomFile ( prefix : string, extension : string = null ) {
        return this.storage.getRandomFile( prefix, extension, this.folder );
    }

    async clean () : Promise<void> {
        await this.storage.cleaner.clean( this.getPath(), this.predicate );
    }
}