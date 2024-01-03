import { BaseTable } from '../../Database/Database';
import { Tool, ToolOption, ToolValueType } from "../Tool";

export interface UpdateIdentifiersOptions {
    dryRun : boolean;
}

export class UpdateIdentifiersTool extends Tool<UpdateIdentifiersOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async run ( options : UpdateIdentifiersOptions ) {
        const allTables: BaseTable<any>[] = [
            this.server.database.tables.people
        ];
        
        const logger = this.logger;

        const statsLogger = logger.service( 'stats' ).live();

        let recordsChanged: number = 0;

        const log = () => {
            statsLogger.info( 'Records changed: ' + recordsChanged );
        };

        for ( const table of allTables ) {
            await table.findStream().parallel( async record => {
                // The method only clones if the identifier is present and changed
                const newRecord = table.applyIdentifier( record, /* clone: */ true );
    
                // So if the instance is different, the object was cloned, so the identifier was changed
                if ( newRecord != record ) {
                    recordsChanged += 1;
    
                    log();

                    if ( !options.dryRun ) {
                        await table.update( record.id, { identifier: newRecord[ 'identifier' ] } );
                    }
                }
            }, 20 ).drain();
        }
    }
}