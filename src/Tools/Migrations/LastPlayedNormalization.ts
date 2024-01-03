import { Tool, ToolOption, ToolValueType } from "../Tool";
import { ExternalReferences, isPlayableRecord, MediaRecord, PlayableMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from '../../MediaRecord';
import { DatabaseTables, HistoryTable, MediaTable, TvSeasonsMediaTable, TvShowsMediaTable } from '../../Database/Database';
import { addDays, format, subDays } from 'date-fns';
import * as r from 'rethinkdb';

export interface LastPlayedNormalizationOptions {
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

export class LastPlayedNormalizationTool extends Tool<LastPlayedNormalizationOptions> {
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

    async createSessionFor ( options : LastPlayedNormalizationOptions, date : Date, record : PlayableMediaRecord ) : Promise<void> {
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

    async run ( options : LastPlayedNormalizationOptions ) {
        await this.server.database.install();

        const logger = this.logger;

        const statsLogger = logger.service( 'stats' ).live();

        const allTables = this.server.database.tables;

        const tables : MediaTable<CommonRecord>[] = [
            allTables.custom, allTables.movies, 
            allTables.shows, allTables.seasons, allTables.episodes,
        ];

        const fmt = ( date : string | number | Date | null | undefined ) => {
            if ( date === null || date === void 0 ) {
                return '';
            }

            return format( date, 'YYYY-MM-DDTHH:mm:ss.SSSZ' );
        };

        let recordsChanged: number = 0;

        const log = () => {
            statsLogger.info( 'Records changed: ' + recordsChanged );
        };

        const maxDate = ( d1 : Date | null, d2 : Date | null ) : Date | null => {
            if ( d1 == null ) {
                return d2;
            }

            if ( d2 == null ) {
                return d1;
            }

            return ( d1 > d2 ) ? d1 : d2;
        };

        log();

        let tvSeasonsChanged : Set<string> = new Set();
        let tvShowsChanged : Set<string> = new Set();

        const messages: { date: Date, msg: string }[] = [];

        for ( let table of tables ) {
            this.logger.info(table.tableName);

            await table.findStream().parallel( async record => {
                let updated = false;

                if ( isPlayableRecord( record ) ) {
                    if ( ( record as any ).lastPlayed != null ) {
                        const date = new Date( ( record as any ).lastPlayed );
    
                        if ( !await this.hasSessionFor( date, record.external ) ) {
                            messages.push( { date, msg: 'Create history for ' + await this.server.media.humanize( record ) + ' at ' + fmt( date ) } );
                            
                            await this.createSessionFor( options, date, record );
                        }
                    }
    
                    if ( record.lastPlayedAt != null ) {
                        const date = new Date( record.lastPlayedAt );
    
                        if ( !await this.hasSessionFor( date, record.external ) ) {
                            messages.push( { date, msg: 'Create history for ' + await this.server.media.humanize( record ) + ' at ' + fmt( date ) } );

                            await this.createSessionFor( options, date, record );
                        }
                    }
                }

                if ( record.lastPlayed != null && record.lastPlayedAt == null ) {
                    if ( !options.dryRun ) {
                        await table.update( record.id, { 
                            lastPlayed: ( r as any ).literal(),
                            lastPlayedAt: record.lastPlayed 
                        } );
                    }

                    updated = true;
                    
                    // logger.info( `${record.title} -> ${fmt( record.lastPlayed )} ${fmt(record.lastPlayedAt)}` );
                } else if ( record.lastPlayed != null && record.lastPlayedAt != null ) {
                    if ( !options.dryRun ) {
                        await table.update( record.id, { lastPlayed: ( r as any ).literal() } );
                    }

                    updated = true;
                } 
                
                if ( table instanceof TvSeasonsMediaTable && tvSeasonsChanged.has( record.id ) ) {
                    const episodes = await table.relations.episodes.load( record as TvSeasonMediaRecord );

                    const lastPlayedAt = episodes
                        .filter( ep => ep.lastPlayedAt != null )
                        .map( ep => ep.lastPlayedAt )
                        .reduce( ( previous, current ) => maxDate( previous, current ), null );
                    
                    if ( !options.dryRun ) {
                        await table.update( record.id, { lastPlayedAt } );
                    }

                    updated = true;

                    tvShowsChanged.add( record.tvShowId );
                }

                if ( table instanceof TvShowsMediaTable && tvShowsChanged.has( record.id ) ) {
                    const seasons = await table.relations.seasons.load( record as TvShowMediaRecord );

                    const lastPlayedAt = seasons
                        .filter( ep => ep.lastPlayedAt != null )
                        .map( ep => ep.lastPlayedAt )
                        .reduce( ( previous, current ) => maxDate( previous, current ), null );
                    
                    if ( !options.dryRun ) {
                        await table.update( record.id, { lastPlayedAt } );
                    }

                    updated = true;
                }

                if ( updated ) {
                    recordsChanged += 1;
    
                    log();

                    if ( record.tvSeasonId != null ) {
                        tvSeasonsChanged.add( record.tvSeasonId );
                    }
                }
             }, 20 ).drain();
        }
        
        statsLogger.close();

        messages.sort( (a, b) => <any>a.date - <any>b.date );

        for (let row of messages) this.log( row.msg );
    }
}