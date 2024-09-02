import { Tool, ToolOption, ToolValueType } from "../Tool";
import { isMovieRecord, isPlayableRecord, isTvEpisodeRecord, MediaRecord } from '../../MediaRecord';
import { AbstractMediaTable } from '../../Database/Database';
import { FileSystemRepository } from '../../Extensions/MediaRepositories/FileSystem/FileSystemRepository';
import { AsyncBreaker } from '../../ES2017/AsyncBreaker';
import * as path from 'path';
import { pp } from 'clui-logger';

export enum PathStyle {
    Win32 = 'win32',
    Posix = 'posix',
}

export interface TranslatePathsOptions {
    translations: string;
    dryRun: boolean;
    listSeparator: string;
    pairSeparator: string;
    sourcePlatform: PathStyle;
    targetPlatform: PathStyle;
}

export class TranslatePathsTool extends Tool<TranslatePathsOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'listSeparator' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( ';' ),
            new ToolOption( 'pairSeparator' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( '=' ),
            new ToolOption( 'sourcePlatform' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( PathStyle.Win32 ),
            new ToolOption( 'targetPlatform' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( PathStyle.Posix ),
        ]
    }

    getParameters () {
        return [
            new ToolOption( 'translations' ),
        ]
    }

    async run ( options : TranslatePathsOptions ) {
        await this.server.database.install();

        const logger = this.logger;

        const statsLogger = logger.service( 'stats' ).live();

        const allTables = this.server.database.tables;

        const tables : AbstractMediaTable<MediaRecord>[] = [
            allTables.custom, allTables.movies,
            allTables.episodes, allTables.seasons, allTables.shows,
        ];

        let recordsChanged: number = 0;

        const log = () => {
            statsLogger.info( 'Records changed: ' + recordsChanged );
        };

        const transformPrefixes = options.translations
            .split( options.listSeparator )
            .map( pair => pair.split( options.pairSeparator ) )
            .map( pair => ( { original: pair[ 0 ], destination: pair[ 1 ] } ) );

        const breaker = new AsyncBreaker();
        
        if (options.sourcePlatform != PathStyle.Win32 && options.sourcePlatform != PathStyle.Posix) {
            this.logger.error(pp`Invalid value ${options.sourcePlatform} for arg ${"sourcePlatform"}, valid options are: ${PathStyle.Win32} and ${PathStyle.Posix}`);
        }
        
        if (options.targetPlatform != PathStyle.Win32 && options.targetPlatform != PathStyle.Posix) {
            this.logger.error(pp`Invalid value ${options.targetPlatform} for arg ${"targetPlatform"}, valid options are: ${PathStyle.Win32} and ${PathStyle.Posix}`);
        }
        
        const sourceSep = path[options.sourcePlatform].sep;
        const targetSep = path[options.targetPlatform].sep;
        
        for ( let table of tables ) { 
            await table.connection.transaction(async trx => {
                for ( let record of await table.findStream( null, { transaction: trx } ).toArray() ) {
                    await breaker.tryBreak();
                    
                    if ( record.repository == null ) {
                        // this.log( 'repo null', table.constructor.name, record.kind, record.title );
                        continue;
                    }
    
                    const repository = this.server.repositories.get( record.repository );
    
                    if ( repository == null ) {
                        continue;
                    }
    
                    if ( !( repository instanceof FileSystemRepository ) ) {
                        continue;
                    }
    
                    if ( isPlayableRecord( record ) ) {
                        let changed = false;
                        
                        if ( record.sources != null ) {
                            for ( const source of record.sources ) {
                                const oldPath = source.id;
                                
                                if ( oldPath == null ) {
                                    continue;
                                }
                                
                                let newPath = oldPath;
                                
                                const transform = transformPrefixes
                                    .find( rule => newPath.toLowerCase().startsWith( rule.original.toLowerCase() ) );
                                    
                                if ( transform == null ) {
                                    continue;
                                }
                                
                                newPath = path.join( transform.destination, newPath.slice( transform.original.length ) );
                                
                                if ( sourceSep != targetSep ) {
                                    newPath = newPath
                                        .split( sourceSep )
                                        .join( targetSep );
                                }
                                
                                if ( newPath != oldPath ) {
                                    source.id = newPath;
                                    
                                    changed = true;
                                }
                            }
                            
                            if ( changed ) {
                                const newPath = record.sources[ 0 ].id;

                                if ( isTvEpisodeRecord( record ) || isMovieRecord( record ) ) {
                                    record.internalId = this.server.hash( newPath );
                                }
                            }
                            
                            if ( changed ) {
                                recordsChanged += 1;
            
                                this.log( record.kind, record.title, JSON.stringify( record.sources ) );
            
                                if ( !options.dryRun ) {
                                    await table.update( record.id, { sources: record.sources, internalId: record.internalId }, { transaction: trx } );
                                }
                            }
                        }
                    }
                }
            });
        }

        log();

        statsLogger.close();
    }
}
