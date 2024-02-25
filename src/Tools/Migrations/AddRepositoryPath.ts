import { Tool, ToolOption, ToolValueType } from "../Tool";
import { isCustomRecord, isMovieRecord, isTvEpisodeRecord, isTvSeasonRecord, isTvShowRecord, MediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from '../../MediaRecord';
import { AbstractMediaTable, TvSeasonsMediaTable, TvShowsMediaTable } from '../../Database/Database';
import { format } from 'date-fns';
import { Knex } from 'knex';
import { FileSystemRepository } from '../../Extensions/MediaRepositories/FileSystem/FileSystemRepository';

export interface AddRepositoryPathOptions {
    dryRun : boolean;
    onlyEmpty : boolean;
}

export class AddRepositoryPathTool extends Tool<AddRepositoryPathOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'onlyEmpty' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( true )
        ]
    }

    async run ( options : AddRepositoryPathOptions ) {
        await this.server.database.install();

        const logger = this.logger;

        const statsLogger = logger.service( 'stats' ).live();

        const allTables = this.server.database.tables;

        const tables : AbstractMediaTable<MediaRecord>[] = [
            allTables.custom, allTables.movies, 
            // The order of the tables is important, since seasons depends on
            // the information discovered by episodes, and shows by seasons
            allTables.episodes, allTables.seasons, allTables.shows,
        ];

        let recordsChanged: number = 0;

        const log = () => {
            statsLogger.info( 'Records changed: ' + recordsChanged );
        };

        const seasonPaths = new Map<string, string[]>();

        const showPaths = new Map<string, string[]>();

        for ( let table of tables ) {
            for await ( let record of table.findStream() ) {
                if ( record.repository == null ) {
                    // this.log( 'repo null', table.constructor.name, record.kind, record.title );
                    continue;
                }

                // If the user provided the option onlyEmpty, skip records that already have
                // a repositoryPath
                if ( options.onlyEmpty == true && record.repositoryPaths != null ) {
                    continue;
                }
                                
                const repository = this.server.repositories.get( record.repository );
                
                if ( repository == null ) {
                    continue;
                } 
                
                if ( !( repository instanceof FileSystemRepository ) ) {
                    continue;
                }

                const oldPaths = [ ...( record.repositoryPaths ?? [] ) ];
                
                if ( isMovieRecord( record ) || isCustomRecord( record ) ) {
                    const repoPath = repository.findVirtualRepositoryForPath( record.sources[ 0 ].id )?.name;

                    if ( repoPath != null ) {
                        record.repositoryPaths = [ repoPath ];
                    } else {
                        record.repositoryPaths = [];
                    }
                } else if ( isTvEpisodeRecord( record ) ) {
                    const repoPath = repository.findVirtualRepositoryForPath( record.sources[ 0 ].id )?.name;

                    if ( repoPath != null ) {
                        record.repositoryPaths = [ repoPath ];
                    } else {
                        record.repositoryPaths = [];
                    }

                    if ( !seasonPaths.has( record.tvSeasonId ) ) {
                        seasonPaths.set( record.tvSeasonId, [] );
                    }

                    const paths = seasonPaths.get( record.tvSeasonId );

                    if ( !paths.includes( repoPath ) ) {
                        paths.push( repoPath );
                    }
                } else if ( isTvSeasonRecord( record ) ) {
                    record.repositoryPaths = seasonPaths.get( record.id ) ?? [];

                    if ( !showPaths.has( record.tvShowId ) ) {
                        showPaths.set( record.tvShowId, [] );
                    }

                    const paths = showPaths.get( record.tvShowId );

                    for ( let path of record.repositoryPaths ) {
                        if ( !paths.includes( path ) ) {
                            paths.push( path );
                        }
                    }
                } else if ( isTvShowRecord( record ) ) {
                    record.repositoryPaths = showPaths.get( record.id ) ?? [];
                }

                const changed = oldPaths.some( name => !record.repositoryPaths.includes( name ) );
                
                if ( changed ) {
                    recordsChanged += 1;
                    
                    this.log( record.kind, record.title, record.repositoryPaths );

                    if ( !options.dryRun ) {
                        await table.update( record.id, { repositoryPaths: record.repositoryPaths } );
                    }
                }
            }
        }

        log();

        statsLogger.close();
    }
}
