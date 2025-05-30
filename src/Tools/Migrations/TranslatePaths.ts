import { Tool, ToolOption, ToolValueType } from "../Tool";
import { isMovieRecord, isPlayableRecord, isTvEpisodeRecord, MediaRecord } from '../../MediaRecord';
import { AbstractMediaTable } from '../../Database/Database';
import { FileSystemRepository } from '../../Extensions/MediaRepositories/FileSystem/FileSystemRepository';
import { AsyncBreaker } from '../../ES2017/AsyncBreaker';
import * as path from 'path';
import { pp } from 'clui-logger';
import { MediaSourceDetails } from '../../MediaProviders/MediaSource';

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
        breaker.breakMs = 10;

        if (options.sourcePlatform != PathStyle.Win32 && options.sourcePlatform != PathStyle.Posix) {
            this.logger.error(pp`Invalid value ${options.sourcePlatform} for arg ${"sourcePlatform"}, valid options are: ${PathStyle.Win32} and ${PathStyle.Posix}`);
        }

        if (options.targetPlatform != PathStyle.Win32 && options.targetPlatform != PathStyle.Posix) {
            this.logger.error(pp`Invalid value ${options.targetPlatform} for arg ${"targetPlatform"}, valid options are: ${PathStyle.Win32} and ${PathStyle.Posix}`);
        }

        const sourceSep = path[options.sourcePlatform].sep;
        const targetSep = path[options.targetPlatform].sep;

        for ( let table of tables ) {
            const chunks = await table.findStream( null ).chunkEvery( 2000 ).toArray();

            for ( const records of chunks ) {
                await table.connection.transaction(async trx => {
                    for ( let record of records ) {
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
                            let [ changed, sources ] = this.transformSources( transformPrefixes, sourceSep, targetSep, record.sources );

                            if ( changed ) {
                                record.sources = sources;
                            }

                            if ( isTvEpisodeRecord( record ) || isMovieRecord( record ) ) {
                                const newPath = record.sources[ 0 ].id;

                                const newInternalId = this.server.hash( newPath );

                                changed = changed || ( record.internalId != newInternalId ) || record.id == '12610';

                                record.internalId = newInternalId;
                            }

                            if ( changed ) {
                                recordsChanged += 1;

                                this.log( record.kind, record.title, record.internalId, JSON.stringify( record.sources ) );

                                if ( !options.dryRun ) {
                                    await table.update( record.id, { sources: record.sources, internalId: record.internalId }, { transaction: trx } );
                                }
                            }
                        }
                    }
                });
            }
        }

        const probeChunks = await allTables.probes.findStream( null ).chunkEvery( 2000 ).toArray();

        for ( const probes of probeChunks ) {
            await allTables.probes.connection.transaction(async trx => {
                for ( let probe of probes ) {
                    await breaker.tryBreak();

                    let [ changed, filename ] = this.transformPath( transformPrefixes, sourceSep, targetSep, probe.raw.format.filename );

                    if ( changed ) {
                        probe.raw.format.filename = filename;
                        probe.metadata.files[ 0 ].id = filename;

                        recordsChanged += 1;

                        this.log( 'probe', probe.mediaKind, probe.mediaId, JSON.stringify( probe.raw.format.filename ) );

                        if ( !options.dryRun ) {
                            await allTables.probes.update( probe.id, { raw: probe.raw, metadata: probe.metadata }, { transaction: trx } );
                        }
                    }
                }
            });
        }

        const historyChunks = await allTables.history.findStream( null ).chunkEvery( 2000 ).toArray();

        for ( const historyRecords of historyChunks ) {
            await allTables.history.connection.transaction(async trx => {
                for ( let history of historyRecords ) {
                    await breaker.tryBreak();

                    let [ changed, sources ] = this.transformSources( transformPrefixes, sourceSep, targetSep, history.mediaSources );

                    if ( changed ) {
                        history.mediaSources = sources;

                        recordsChanged += 1;

                        this.log( 'history', history.mediaKind, history.mediaId, JSON.stringify( history.mediaSources ) );

                        if ( !options.dryRun ) {
                            await allTables.history.update( history.id, { mediaSources: history.mediaSources }, { transaction: trx } );
                        }
                    }
                }
            });
        }

        log();

        statsLogger.close();
    }

    protected transformSources( transformPrefixes: TransformPrefix[], sourceSep: string, targetSep: string, sources: MediaSourceDetails[] ): [ boolean, MediaSourceDetails[] ] {
        let changed = false;

        if ( sources != null && sources instanceof Array ) {
            sources = sources.map( source => {
                const oldPath = source.id;

                if ( oldPath == null ) {
                    return source;
                }

                let [ sourceChanged, newPath ] = this.transformPath( transformPrefixes, sourceSep, targetSep, oldPath );

                if ( sourceChanged ) {
                    changed = true;

                    return { ...source, id: newPath };
                } else {
                    return source;
                }
            } );
        }

        return [ changed, sources ]
    }

    protected transformPath( transformPrefixes: TransformPrefix[], sourceSep: string, targetSep: string, oldPath: string ): [ boolean, string ] {
        let changed = false;

        let newPath = oldPath;

        const transform = transformPrefixes
            .find( rule => newPath.toLowerCase().startsWith( rule.original.toLowerCase() ) );

        if ( transform == null ) {
            return [ false, null ];
        }

        newPath = path.join( transform.destination, newPath.slice( transform.original.length ) );

        if ( sourceSep != targetSep ) {
            newPath = newPath
                .split( sourceSep )
                .join( targetSep );
        }

        if ( newPath != oldPath ) {
            changed = true;
        }

        return [changed, newPath]
    }
}

type TransformPrefix = {
    original: string;
    destination: string;
};
