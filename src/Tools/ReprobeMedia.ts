import { pp } from 'clui-logger';
import { Semaphore } from 'data-semaphore';
import { Tool, ToolOption, ToolValueType } from './Tool';
import { AsyncBreaker } from '../ES2017/AsyncBreaker';
import { AbstractMediaTable, PlayableMediaRecord } from '../Database/Tables/AbstractMediaTable';
import { MediaProbeRecord } from '../Database/Tables/MediaProbesTable';

export interface ReprobeMediaOptions {
    dryRun : boolean;
    partial ?: string;
    listSeparator : string;
    concurrency : number;
}

interface ReprobeFailure {
    record : PlayableMediaRecord;
    path : string;
    error : any;
}

/**
 * Probes again every playable media record that either has no cached probe, or whose cached probe was made from a
 * different file than the record's current `sources[0].id`. The probe is stored, and the record's metadata recomputed.
 *
 * Use `--partial "/prefix/one;/prefix/two"` to only consider media whose file starts with one of the given prefixes.
 */
export class ReprobeMediaTool extends Tool<ReprobeMediaOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'partial' ).setRequired( false ).setType( ToolValueType.String ),
            new ToolOption( 'listSeparator' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( ';' ),
            new ToolOption( 'concurrency' ).setRequired( false ).setType( ToolValueType.Number ).setDefaultValue( 2 ),
        ];
    }

    protected needsReprobe ( record : PlayableMediaRecord & { probe ?: MediaProbeRecord | null } ) : boolean {
        if ( record.probe == null ) {
            return true;
        }

        return record.probe.raw?.format?.filename != record.sources?.[ 0 ]?.id;
    }

    async run ( options : ReprobeMediaOptions ) {
        await this.server.database.install();

        const prefixes = options.partial
            ? options.partial.split( options.listSeparator ).map( prefix => prefix.trim() ).filter( prefix => prefix != '' )
            : null;

        if ( prefixes != null && prefixes.length === 0 ) {
            this.logger.error( pp`The ${ 'partial' } option was given, but no path prefixes were found in it.` );

            return;
        }

        const breaker = new AsyncBreaker();

        const semaphore = new Semaphore( Math.max( 1, options.concurrency || 1 ) );

        const tables : AbstractMediaTable<PlayableMediaRecord>[] = [
            this.server.database.tables.movies,
            this.server.database.tables.episodes,
            this.server.database.tables.custom,
        ];

        const pending : PlayableMediaRecord[] = [];

        let skipped = 0;

        for ( const table of tables ) {
            const records = await table.relations.probe.applyAll( await table.findStream().toArray() );

            for ( const record of records ) {
                const path = record.sources?.[ 0 ]?.id;

                if ( path == null ) {
                    skipped += 1;
                    continue;
                }

                if ( prefixes != null && !prefixes.some( prefix => path.startsWith( prefix ) ) ) {
                    continue;
                }

                if ( !this.needsReprobe( record ) ) {
                    skipped += 1;
                    continue;
                }

                pending.push( record );
            }

            await breaker.tryBreak();
        }

        this.logger.info( pp`Found ${ pending.length } media records to probe (${ skipped } already up to date or without a file).` );

        if ( options.dryRun ) {
            for ( const record of pending ) {
                this.logger.info( pp`[dry run] Would probe ${ record.kind } ${ record.id } ${ record.title }: ${ record.sources[ 0 ].id }` );
            }

            return;
        }

        const failures : ReprobeFailure[] = [];

        let probed = 0;

        await Promise.all( pending.map( record => semaphore.use( async () => {
            const path = record.sources[ 0 ].id;

            try {
                await this.server.media.probe( record,
                    /* readCache: */ false,
                    /* writeCache: */ true,
                    /* updateMetadata: */ true );

                probed += 1;

                this.logger.info( pp`${ probed + failures.length }/${ pending.length } Probed ${ record.kind } ${ record.id } ${ record.title }` );
            } catch ( error ) {
                failures.push( { record, path, error } );

                this.logger.error( pp`${ probed + failures.length }/${ pending.length } Failed to probe ${ record.kind } ${ record.id } ${ record.title } (${ path }): ${ error?.message ?? error }` );
            }

            await breaker.tryBreak();
        } ) ) );

        this.logger.info( pp`Done. Probed: ${ probed }, failed: ${ failures.length }, skipped: ${ skipped }.` );

        if ( failures.length > 0 ) {
            this.logger.error( 'Failures:' );

            for ( const { record, path, error } of failures ) {
                this.logger.error( pp`  ${ record.kind } ${ record.id } ${ path }: ${ error?.message ?? error }` );
            }
        }
    }
}
