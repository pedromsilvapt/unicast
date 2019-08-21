import { Tool, ToolOption, ToolValueType } from "../Tool";
import { MediaKind } from '../../MediaRecord';
import { MediaSync } from '../../MediaSync';
import * as chalk from 'chalk';

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

        const statsLogger = this.logger.service('stats').live();
        const logger = this.logger.live();

        if ( options.truncate ) {
            logger.info( 'Truncating...' );

            await this.server.database.tables.mediaCast.deleteAll();
            await this.server.database.tables.people.deleteAll();
        }

        const sync = new MediaSync( this.server.media, this.server.database, this.server.repositories, this.server.scrapers, this.logger.shared() );

        for ( let kind of [ MediaKind.Movie, MediaKind.TvShow ] ) {
            let updatedPeople = 0;
            let createdPeople = 0;
            let deletedCast = 0;

            const table = this.server.media.getTable( kind );

            const total = await table.count();

            let doneCount = 0;

            statsLogger.info( `${ chalk.cyan( createdPeople ) } created, ${ chalk.cyan( updatedPeople ) } updated, ${ chalk.cyan( deletedCast ) } deleted` );

            await table.findStream().parallel( async record => {
                try {
                    logger.info( `[${ kind } ${record.title}] ${ doneCount }/${ total }` );

                    const stats = await sync.runCast( record, options.dryRun );

                    if ( stats ) {
                        updatedPeople += stats.existingPeopleCount;
                        createdPeople += stats.createdPeopleCount;
                        deletedCast += stats.deletedCastCount;

                        statsLogger.info( `${ chalk.cyan( createdPeople ) } created, ${ chalk.cyan( updatedPeople ) } updated, ${ chalk.cyan( deletedCast ) } deleted` );
                    }
                } catch ( error ) {
                    logger.static().error( `[${ kind } ${sync.print( record )}] ${ JSON.stringify( record.external ) } ${ error.message } ${ error.stack }` );
                } finally {
                    doneCount++;
                }                
            }, 10 ).last();
        }

        logger.close();
        statsLogger.close();
    }
}