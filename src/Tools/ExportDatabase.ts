import { UnicastServer } from "../UnicastServer";
import * as fs from 'mz/fs';
import { BaseTable } from "../Database/Database";
import * as path from 'path';
import { Tool, ToolOption } from "./Tool";

interface ExportDatabaseOptions {
    folder : string;
}

export class ExportDatabaseTool extends Tool<ExportDatabaseOptions> {
    getParameters () {
        return [ 
            new ToolOption( 'folder' ).setRequired()
        ]
    }

    async exportTable ( table : BaseTable<any>, file : string ) {
        this.log( 'Exporting', table.tableName, 'to', file );

        const records = await table.find();

        await this.server.storage.ensureDir( path.dirname( file ) );

        await fs.writeFile( file, JSON.stringify( records ) );

        this.log( 'Exported', records.length, 'records' );
    }

    async run ( options : ExportDatabaseOptions ) {
        const { folder } = options;

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
            this.server.database.tables.subtitles
        ];
    
        for ( let table of tables ) {
            await this.exportTable( table, path.join( folder, 'table_' + table.tableName + '.json' ) )
        }
    
        this.log( 'All tables exported' );
    }
}
