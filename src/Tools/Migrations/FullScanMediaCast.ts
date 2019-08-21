import { Tool, ToolOption, ToolValueType } from "../Tool";
import { MediaKind } from '../../MediaRecord';
import { MediaSync } from '../../MediaSync';

export interface FullScanMediaCastOptions {
    truncate : boolean;
    dryRun : boolean;
}

export class FullScanMediaCastTool extends Tool<FullScanMediaCastOptions> {
    getOptions () {
        return [
            new ToolOption( 'truncate' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async run ( options : FullScanMediaCastOptions ) {
        await this.server.database.install();

        const logger = this.logger.live();

        if ( options.truncate ) {
            logger.info( 'Truncating...' );

            await this.server.database.tables.mediaCast.deleteAll();
            await this.server.database.tables.people.deleteAll();
        }

        const sync = new MediaSync( this.server.media, this.server.database, this.server.repositories, this.server.scrapers, this.logger.shared() );

        for ( let kind of [ MediaKind.Movie, MediaKind.TvShow ] ) {
            const table = this.server.media.getTable( kind );

            const total = await table.count();

            let doneCount = 0;

            await table.findStream().parallel( async record => {
                try {
                    logger.info( `[${ kind } ${record.title}] ${ doneCount }/${ total }` );

                    await sync.runCast( record, options.dryRun );
                } catch ( error ) {
                    logger.static().error( `[${ kind } ${sync.print( record )}] ${ JSON.stringify( record.external ) } ${ error.message } ${ error.stack }` );
                } finally {
                    doneCount++;
                }                
            }, 1 ).last();
        }

        logger.close();
    }
}