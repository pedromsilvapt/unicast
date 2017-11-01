import { UnicastServer } from "./UnicastServer";
import * as uid from 'uid';
import * as fs from 'mz/fs';
import * as path from 'path';

export class Storage {
    server : UnicastServer;

    randomNameLength : number = 15;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async ensureDir ( folder : string ) : Promise<void> {
        if ( !( await fs.exists( folder ) ) ) {
            await this.ensureDir( path.dirname( folder ) );

            await fs.mkdir( folder );
        }
    }

    async getRandomFolder ( prefix : string = null ) : Promise<string> {
        const storagePath = this.server.config.get( 'storage', 'storage' );

        const random = uid( this.randomNameLength );

        const folder = path.resolve( path.join( 
            storagePath,
            'temp',
            'folders',
            ( prefix ? ( prefix + '' ) : '' ) + random
        ) );

        await this.ensureDir( folder );

        return folder;
    }

    async getRandomFile ( prefix : string, extension : string = null ) {
        const storagePath = this.server.config.get( 'storage', 'storage' );
        
        const random = uid( this.randomNameLength );

        const file = path.resolve( path.join( 
            storagePath,
            'temp',
            'files',
            ( prefix ? ( prefix + '' ) : '' ) + random + ( extension ? ( '.' + extension ) : '' )
        ) );

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