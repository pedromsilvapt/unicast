import { pp } from 'clui-logger';
import { FileSystemScanner } from '../../Extensions/MediaRepositories/FileSystem/FileSystemScanner';
import { MediaTools, ParsePathMode } from '../../MediaTools';
import { Tool, ToolOption, ToolValueType } from "../Tool";
import * as fs from "mz/fs";
import { AsyncBreaker } from '../../ES2017/AsyncBreaker';
import { AbstractMediaTable, MediaMetadata, PlayableMediaRecord } from '../../Database/Tables/AbstractMediaTable';

export interface UpdateMovieQualitiesOptions {
    dryRun : boolean;
    live : boolean;
    cached : boolean;
}

export class UpdateMovieQualitiesTool extends Tool<UpdateMovieQualitiesOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'live' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( true ),
            new ToolOption( 'cached' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
        ];
    }

    async run ( options : UpdateMovieQualitiesOptions ) {
        await this.server.database.install();

        const logger = options.live
            ? this.logger.live()
            : this.logger;

        const breaker = new AsyncBreaker();

        const filesystem = this.server.providers.get( 'filesystem' );

        const tables: AbstractMediaTable<PlayableMediaRecord>[] = [ this.server.database.tables.movies, this.server.database.tables.episodes ];

        for (const table of tables ) {
            const recordsList = await table.relations.probe.applyAll( await table.findStream().toArray() );

            const total = recordsList.length;

            for ( let [ index, record ] of recordsList.entries() ) {
                let changed = false;

                const isFile = record.sources.some( source => filesystem.match( source.id ) );

                if ( !isFile ) {
                    continue;
                }

                if ( !options.cached && !await fs.exists( record.sources[ 0 ].id ) ) {
                    continue;
                }

                let metadata: MediaMetadata;

                if ( options.cached && !record.probe ) {
                    continue;
                }

                try {
                    metadata = record.probe != null
                        ? await this.server.mediaTools.convertToMetadata( record.probe.metadata )
                        : await this.server.mediaTools.getMetadata( record );
                } catch (err) {
                    this.logger.error(`Failed to get metadata for ${ record.sources[ 0 ].id }`);
                    this.logger.error(err.message + '\n' + err.stackTrace);
                    continue;
                }

                if ( table.isChanged( record, { metadata } ) ) {
                    logger.info( pp`${ index + 1 }/${ total } Changing ${ record.title }, ${ JSON.stringify( record.metadata ) } to ${ JSON.stringify( metadata ) }` );

                    record.metadata = metadata;

                    changed = true;
                } else if ( options.live ) {
                    logger.info( pp`${ index + 1 }/${ total } No changes detected for ${ record.title }` );
                }

                if ( changed ) {
                    const table = this.server.media.getTable( record.kind );

                    if ( !options.dryRun ) {
                        await table.update( record.id, { metadata: record.metadata } );
                    }
                }

                await breaker.tryBreak();
            }
        }
    }
}
