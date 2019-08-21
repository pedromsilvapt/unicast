import * as fs from 'mz/fs';
import { BaseTable } from "../Database/Database";
import * as path from 'path';
import { Tool, ToolOption, ToolValueType } from "./Tool";
import { format } from 'date-fns';
import { Stopwatch } from '../BackgroundTask';
import * as filesize from 'filesize';

interface ExportDatabaseOptions {
    folder : string;
    timestamp : boolean;
}

export class ExportDatabaseTool extends Tool<ExportDatabaseOptions> {
    getParameters () {
        return [ 
            new ToolOption( 'folder' ).setDefaultValue( this.server.storage.getPath( 'backups', `${ this.server.name }_database_${ this.server.config.get( 'database.db' ) }_backup` ) ),
            new ToolOption( 'timestamp' ).setType( ToolValueType.Boolean ).setDefaultValue( true )
        ]
    }

    async exportTable ( table : BaseTable<any>, file : string ) : Promise<number> {
        const stopwatch = new Stopwatch().resume();

        this.log( 'Exporting', table.tableName, 'to', file );

        const records = await table.find();

        await this.server.storage.ensureDir( path.dirname( file ) );

        const buffer = Buffer.from( JSON.stringify( records ) );

        await fs.writeFile( file, buffer );

        this.log( 'Exported', records.length, 'records', `(in ${ stopwatch.readHumanized() }, ${filesize( buffer.byteLength )})` );

        return buffer.byteLength;
    }

    async run ( options : ExportDatabaseOptions ) {
        let { folder } = options;

        if ( options.timestamp ) {
            folder = path.join( path.dirname( folder ), `${ format( Date.now(), 'YYYYMMDD_HHmmss' ) }_${ path.basename( folder ) }` );
        }

        let tables : BaseTable<any>[] = [
            this.server.database.tables.collections,
            this.server.database.tables.collectionsMedia,
            this.server.database.tables.custom,
            this.server.database.tables.episodes,
            this.server.database.tables.history,
            this.server.database.tables.jobsQueue,
            this.server.database.tables.movies,
            this.server.database.tables.playlists,
            this.server.database.tables.seasons,
            this.server.database.tables.shows,
            this.server.database.tables.subtitles,
            this.server.database.tables.people,
            this.server.database.tables.mediaCast
        ];
    
        const stopwatch = new Stopwatch().resume();

        let size = 0;

        for ( let table of tables ) {
            size += await this.exportTable( table, path.join( folder, 'table_' + table.tableName + '.json' ) )
        }

        stopwatch.pause();
    
        this.log( 'All tables exported', `(in ${ stopwatch.readHumanized() }, ${ filesize( size ) })` );
    }
}
