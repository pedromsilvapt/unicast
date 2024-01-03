import { Tool, ToolOption, ToolValueType } from "./Tool";
import { MediaKind, AllMediaKinds, PlayableQualityRecord, MediaRecordArt } from "../MediaRecord";
import * as parseTorrentName from 'parse-torrent-name';
import { MediaTools } from "../MediaTools";
import * as path from 'path';
import * as r from 'rethinkdb';

export interface RenameReceiverOptions {
    oldName: string;
    newName: string;
    dryRun: boolean;
}

export class RenameReceiverTool extends Tool<RenameReceiverOptions> {
    getParameters () {
        return [
            new ToolOption( 'oldName' ).setRequired(),
            new ToolOption( 'newName' ).setRequired(),
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
        ];
    }

    async run ( options : RenameReceiverOptions ) {
        if ( options.dryRun ) {
            // NO ACTUAL MUTATION, JUST READ-ONLY QUERIES HERE

            const historyRecords = await this.server.database.tables.history.count( q => q.filter( {
                receiver: options.oldName
            } ) );

            this.log(`Renamed ${historyRecords} history records from "${options.oldName}" to "${options.newName}".`);

            const playlistRecords = await this.server.database.tables.playlists.count( q => q.filter( {
                device: options.oldName
            } ) );

            this.log(`Renamed ${playlistRecords} playlist records from "${options.oldName}" to "${options.newName}".`);
        } else {
            const historyRecords = await this.server.database.tables.history.updateMany( {
                receiver: options.oldName
            }, {
                receiver: options.newName
            } );

            this.log(`Renamed ${historyRecords} history records from "${options.oldName}" to "${options.newName}".`);

            const playlistRecords = await this.server.database.tables.playlists.updateMany( {
                device: options.oldName
            }, {
                device: options.newName
            } );

            this.log(`Renamed ${playlistRecords} playlist records from "${options.oldName}" to "${options.newName}".`);
        }
    }
}
