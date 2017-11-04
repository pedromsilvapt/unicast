import { UnicastServer } from "./UnicastServer";
import * as uid from 'uid';
import * as fs from 'mz/fs';
import * as path from 'path';
import { Singleton } from "./ES2017/Singleton";

export class Storage {
    server : UnicastServer;

    randomNameLength : number = 15;

    constructor ( server : UnicastServer ) {
        this.server = server;
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
        const random = uid( this.randomNameLength );

        const folder = this.getPath( 
            container, 
            ( prefix ? ( prefix + '' ) : '' ) + random
        );
        
        await this.ensureDir( folder );

        return folder;
    }

    async getRandomFile ( prefix : string, extension : string = null, container : string = 'temp/files' ) {
        const storagePath = this.server.config.get( 'storage', 'storage' );
        
        const random = uid( this.randomNameLength );

        const file = this.getPath( 
            container,
            ( prefix ? ( prefix + '' ) : '' ) + random + ( extension ? ( '.' + extension ) : '' )            
        );

        await this.ensureDir( path.dirname( file ) );

        return file;
    }
}

export class StorageCacheContainer {
    folder : string;
    
    constructor ( folder : string ) {
        this.folder = folder;
    }
}