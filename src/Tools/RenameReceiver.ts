import { Tool, ToolOption, ToolValueType } from "./Tool";

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

            const historyRecords = await this.server.database.tables.history.count( q => q.where( {
                receiver: options.oldName
            } ) );

            this.log(`Renamed ${historyRecords} history records from "${options.oldName}" to "${options.newName}".`);

            const playlistRecords = await this.server.database.tables.playlists.count( q => q.where( {
                device: options.oldName
            } ) );

            this.log(`Renamed ${playlistRecords} playlist records from "${options.oldName}" to "${options.newName}".`);
        } else {
            const historyRecords = await this.server.database.tables.history.updateMany( q => q.where( {
                receiver: options.oldName
            } ), {
                receiver: options.newName
            } );

            this.log(`Renamed ${historyRecords} history records from "${options.oldName}" to "${options.newName}".`);

            const playlistRecords = await this.server.database.tables.playlists.updateMany( q => q.where( {
                device: options.oldName
            } ), {
                device: options.newName
            } );

            this.log(`Renamed ${playlistRecords} playlist records from "${options.oldName}" to "${options.newName}".`);
        }
    }
}
