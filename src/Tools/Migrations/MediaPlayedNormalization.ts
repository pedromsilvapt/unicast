import { Tool, ToolOption, ToolValueType } from "../Tool";
import { ExternalReferences, isPlayableRecord, MediaRecord, PlayableMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from '../../MediaRecord';
import { DatabaseTables, HistoryTable, MediaTable, TvSeasonsMediaTable, TvShowsMediaTable } from '../../Database/Database';
import { addDays, format, subDays } from 'date-fns';
import * as r from 'rethinkdb';

export interface MediaPlayedNormalizationOptions {
    dryRun : boolean;
}

// Interface representing the fields in common we need from each table
export interface CommonRecord extends MediaRecord {
    id ?: string;
    lastPlayed ?: Date | string;
    lastPlayedAt: Date | null;
    tvSeasonId ?: string;
    tvShowId ?: string;
}

export class MediaPlayedNormalizationTool extends Tool<MediaPlayedNormalizationOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async run ( options : MediaPlayedNormalizationOptions ) {
        await this.server.database.install();

        const logger = this.logger;

        const statsLogger = logger.service( 'stats' ).live();

        const allTables = this.server.database.tables;

        const tables : MediaTable<CommonRecord>[] = [
            allTables.custom, allTables.movies, 
            allTables.episodes, allTables.seasons, allTables.shows,
        ];

        const fmt = ( date : string | number | Date | null | undefined ) => {
            if ( date === null || date === void 0 ) {
                return '';
            }

            return format( date, 'YYYY-MM-DDTHH:mm:ss.SSSZ' );
        };

        let recordsChanged: number = 0;

        const log = async ( record: MediaRecord, changes: any ) => {
            statsLogger.static().info( await this.server.media.humanize( record ) + ': ' + JSON.stringify( changes ) );
        };
        const logCounter = ( table: any, count: number ) => {
            statsLogger.info( table.constructor.name + ' Records changed: ' + count );
        };

        for ( let table of tables ) {
            this.logger.info(table.tableName);

            await table.findStream().parallel( async record => {
                try {
                    const lastPlayedAtLegacy: Date[] = [];
    
                    if ( record.lastPlayedAt != null ) {
                        lastPlayedAtLegacy.push( new Date( record.lastPlayedAt ) );
                    }
    
                    if ( record.lastPlayed != null ) {
                        lastPlayedAtLegacy.push( new Date( record.lastPlayed ) );
                    }
    
                    var changes = {
                        ...await this.server.media.watchTracker.onPlayRepairChanges( record ),
                        lastPlayedAtLegacy,
                        lastPlayed: (r as any).literal(),
                    }
    
                    logCounter( table, ++recordsChanged );

                    if ( !options.dryRun ) {
                        await table.updateIfChanged( record, changes );
                    }
                } catch ( error ) {
                    this.server.onError.notify( error );
                }
            }, 20 ).drain();
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));

        statsLogger.close();
    }
}