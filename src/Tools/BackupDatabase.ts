import * as fs from 'mz/fs';
import * as path from 'path';
import { Tool, ToolOption, ToolValueType } from "./Tool";
import { format } from 'date-fns';
import { Stopwatch } from '../BackgroundTask';
import * as filesize from 'filesize';

interface BackupDatabaseOptions {
    folder : string;
    timestamp : boolean;
}

export class BackupDatabaseTool extends Tool<BackupDatabaseOptions> {
    getParameters () {
        return [
            new ToolOption( 'folder' ).setDefaultValue( this.server.storage.getPath( 'backups', `${ this.server.name }_database_${ this.server.config.get( 'database.db' ) }_backup` ) ),
            new ToolOption( 'timestamp' ).setType( ToolValueType.Boolean ).setDefaultValue( true )
        ]
    }

    async backupDatabase ( file : string ) : Promise<number> {
        await this.server.database.connection.raw(`VACUUM INTO ?`, [file]);

        const stat = await fs.stat( file );

        return stat.size;
    }

    async run ( options : BackupDatabaseOptions ) {
        let { folder } = options;

        if ( options.timestamp ) {
            folder = path.join( path.dirname( folder ), `${ format( Date.now(), 'YYYYMMDD_HHmmss' ) }_${ path.basename( folder ) }` );
        }

        const stopwatch = new Stopwatch().resume();

        let size = await this.backupDatabase( path.join( folder + '.db' ) );

        stopwatch.pause();

        this.log( 'Backup generated', `(in ${ stopwatch.readHumanized() }, ${ filesize( size ) })` );
    }
}
