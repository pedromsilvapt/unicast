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

    async hasSessionFor ( date : Date, external: ExternalReferences ) : Promise<boolean> {
        const history: HistoryTable = this.server.database.tables.history;

        const startDate = subDays( date, 1 );
        const endDate = addDays( date, 1 );

        // let nearbySessions = await history.find( query => {
        //     return query.filter( row => row( 'createdAt' ).gt( startDate ).and( row( 'createdAt' ).lt( endDate ) ) );
        // } );

        let nearbySessions = await history.find( query => {
            return query.between( startDate, endDate, { index: 'createdAt' } );
        } );

        await history.relations.record.applyAll( nearbySessions );
        
        history.relations.record.typed( nearbySessions );

        return nearbySessions.some( session => {
            if ( session.record == null ) return false;

            return Object.keys( session.record.external )
                .some( key => session.record.external[ key ] == external[ key ] && external[ key ] != null );
        } );
    }

    async createSessionFor ( options : MediaPlayedNormalizationOptions, date : Date, record : PlayableMediaRecord ) : Promise<void> {
        if ( !options.dryRun ) {
            await this.server.database.tables.history.create( {
                createdAt: date,
                position: record.runtime * 1000,
                positionHistory: [ { start: 0, end: record.runtime * 1000 } ],
                receiver: 'Unknown',
                reference: { kind: record.kind, id: record.id },
                updatedAt: date,
                watched: true,
                playlist: null,
                playlistPosition: null,
                transcoding: null,
            } );
        }
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

        const messages: { date: Date, msg: string }[] = [];

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
                    }
    
                    if (lastPlayedAtLegacy.length > 0) {   
                        await log( record, changes );
                    }
    
                    if ( options.dryRun == false ) {
                        await table.updateIfChanged( record, changes );
                    }
                } catch ( error ) {
                    this.server.onError.notify( error );
                }
            }, 1 ).drain();
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));

        statsLogger.close();

        messages.sort( (a, b) => <any>a.date - <any>b.date );

        for (let row of messages) this.log( row.msg );
    }
}