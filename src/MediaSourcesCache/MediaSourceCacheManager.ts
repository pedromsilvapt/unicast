import {isPlayableRecord, MediaKind, PlayableMediaRecord} from '../MediaRecord';
import { UnicastServer } from '../UnicastServer';
import { CancelToken, CancelledError } from 'data-cancel-token';
import { MediaSourceDetails } from '../MediaProviders/MediaSource';
import { MediaSourceCacheRecord, MediaSourceCacheState } from '../Database/Database';
import * as fs from 'mz/fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as mime from 'mime';
import * as mkdirp from 'mkdirp';
import { saveStreamTo } from '../ArtworkCache';
import { chunk } from '../Database/Tables/BaseTable';
import {collect, groupingBy, mapping} from "data-collectors";
import {LoggerInterface} from "clui-logger";

export interface MediaSourceRef {
    kind : MediaKind;
    id : string;
}

export class MediaSourceCacheManager {
    readonly server : UnicastServer;

    readonly logger : LoggerInterface;

    running : boolean = false;

    currentCancel : CancelToken | null = null;

    /** Id of the cache row whose copy `currentCancel` belongs to */
    currentRowId : string | null = null;

    /** Settles once the in-flight copy has finished, including closing its files and cleaning up after a cancel */
    currentCopy : Promise<void> | null = null;

    afterCurrentCancel : CancelToken | null = null;

    /** Shared so that concurrent starts all wait for the orphan sweep before copying anything */
    protected initialization : Promise<void> | null = null;

    constructor ( server : UnicastServer ) {
        this.server = server;
        this.logger = this.server.logger.service( "media-cache" );
    }

    get table () {
        return this.server.database.tables.mediaSourcesCache;
    }

    /**
     * Runs once, on the first start: removes the cached files of media records as they get deleted, and sweeps
     * any cache folders already orphaned (e.g. episodes removed through the `ON DELETE CASCADE` of their show,
     * which bypasses the per-table delete hooks).
     */
    protected initialize () : Promise<void> {
        return this.initialization ??= this.doInitialize();
    }

    protected doInitialize () : Promise<void> {
        const tables = this.server.database.tables;

        for ( const table of [ tables.movies, tables.episodes, tables.custom ] ) {
            table.onDelete.subscribe( record => this.onMediaDeleted( record as PlayableMediaRecord ) );
        }

        return this.pruneOrphanFolders().catch( error => {
            this.server.logger.error( `media-cache`, `Could not prune orphan cache folders`, error );
        } );
    }

    protected async onMediaDeleted ( record : PlayableMediaRecord ) {
        const row = await this.findRow( { kind: record.kind, id: record.id } );

        if ( row != null ) {
            // Wait for the copy to release its files before deleting the folder
            await this.cancelIfCurrent( row.id );
        }

        // Delete the folder even without a row: the FK cascade may have already removed it
        await this.clearSourceCacheFiles( record );
    }

    protected async pruneOrphanFolders () {
        const root = this.server.storage.getPath( 'cache', 'media' );

        const kinds = await this.readSubFolders( root ).catch( error => {
            if ( error?.code === 'ENOENT' ) return [] as string[];

            throw error;
        } );

        if ( kinds.length === 0 ) return;

        // Rows of deleted media records are gone from this list: the table's FK to `media` is `ON DELETE CASCADE`,
        // and better-sqlite3 is compiled with `foreign_keys` enabled by default
        const known = new Set( ( await this.list() ).map( row => `${ row.mediaKind }/${ row.mediaId }` ) );

        for ( const kind of kinds ) {
            for ( const id of await this.readSubFolders( path.join( root, kind ) ) ) {
                if ( !known.has( `${ kind }/${ id }` ) ) {
                    this.logger.info( `Deleting orphan cache folder ${ kind }/${ id }` );

                    await this.deleteFolder( path.join( root, kind, id ) );
                }
            }
        }
    }

    /** Names of the directories inside `folder`, skipping stray files (e.g. `.DS_Store`) */
    protected async readSubFolders ( folder : string ) : Promise<string[]> {
        const entries = await fsp.readdir( folder, { withFileTypes: true } );

        return entries.filter( entry => entry.isDirectory() ).map( entry => entry.name );
    }

    start () {
        // Clear any pending stop request even if the worker is still running: a graceful stop followed by
        // start/enqueue while the current copy is in flight must keep the worker going afterwards.
        this.afterCurrentCancel = null;

        if ( this.running ) return;

        this.initialize()
            .then( () => this.resetInterruptedCopying() )
            .then( () => this.run() )
            .catch( error => this.server.logger.error( `media-cache`, `Media cache worker stopped unexpectedly`, error ) );
    }

    stop ( onlyAfterCurrent : boolean = false ) {
        this.afterCurrentCancel = new CancelToken();

        if ( !onlyAfterCurrent ) {
            this.currentCancel?.cancel();
        }
    }

    async run () {
        if ( this.running ) return;

        this.running = true;

        try {
            while ( !this.afterCurrentCancel?.cancellationRequested ) {
                const row = await this.pickNextQueued();

                if ( !row ) break;

                try {
                    await this.process( row );
                } catch ( error ) {
                    // Any error must take the row out of the 'queued' state: otherwise, being the oldest queued row,
                    // it would be picked (and fail) again forever, blocking every row behind it.
                    // If even this update fails, let the error stop the worker instead of spinning on the same row.
                    this.server.logger.error( `media-cache`, `Could not process cache row ${ row.id }`, error );

                    await this.table.update( String( row.id ), {
                        state: 'failed',
                        lastAttemptAt: new Date(),
                        error: String( error?.message ?? error )
                    } as any );
                }
            }
        } finally {
            this.running = false;
        }
    }

    protected async process ( row : MediaSourceCacheRecord ) {
        // `media.get` resolves to null (instead of throwing) when the record does not exist
        const record = await this.server.media.get( row.mediaKind, row.mediaId ) as PlayableMediaRecord | null;

        if ( record == null ) {
            throw new Error( `Media record ${ row.mediaKind } ${ row.mediaId } not found` );
        }

        const repoName = record.repository;

        if ( repoName ) {
            const repo = this.server.repositories.get( repoName );

            if ( repo && !( await repo.isMediaReachable( record ) ) ) {
                await this.table.update( String( row.id ), {
                    state: 'paused',
                    lastAttemptAt: new Date(),
                    error: 'Repository offline'
                } as any );

                return;
            }
        }

        await this.copy( row, record );
    }

    protected async pickNextQueued () : Promise<MediaSourceCacheRecord | null> {
        return this.table.findOne(
            // Rows created in the same batch share their `createdAt`, so tie-break by id to keep insertion order
            query => query.where( { state: 'queued' } ).orderBy( 'createdAt', 'asc' ).orderBy( 'id', 'asc' )
        );
    }

    protected copy ( row : MediaSourceCacheRecord, record : PlayableMediaRecord ) : Promise<void> {
        const copy = this.currentCopy = this.doCopy( row, record ).finally( () => {
            if ( this.currentCopy === copy ) {
                this.currentCopy = null;
            }
        } );

        return copy;
    }

    protected async doCopy ( row : MediaSourceCacheRecord, record : PlayableMediaRecord ) {
        await this.table.update( String( row.id ), {
            state: 'copying',
            lastAttemptAt: new Date(),
            error: null
        } as any );

        const cancel = this.currentCancel = new CancelToken();

        this.currentRowId = String( row.id );

        try {
            const sources = await this.populateSourceCache( record, cancel );

            if ( !cancel.cancellationRequested ) {
                if ( sources.length === 0 ) {
                    await this.deleteCacheFolder( record );

                    await this.table.update( String( row.id ), {
                        state: 'failed',
                        lastAttemptAt: new Date(),
                        error: 'No streams produced'
                    } as any );
                } else {
                    await this.table.update( String( row.id ), {
                        state: 'ready',
                        sources,
                        error: null
                    } as any );
                }
            }
        } catch ( e ) {
            await this.deleteCacheFolder( record );

            if ( !( e instanceof CancelledError ) ) {
                await this.table.update( String( row.id ), {
                    state: 'failed',
                    error: String( e?.message ?? e )
                } as any );
            } else {
                // Whoever cancelled may have already moved the row on (force requeue → queued, remove → deleted).
                // Otherwise (e.g. stop) put it back in the queue, like resetInterruptedCopying does on start,
                // so it does not stay in 'copying' if the worker keeps running.
                await this.table.updateMany(
                    query => query.where( { id: row.id, state: 'copying' } ),
                    { state: 'queued' as MediaSourceCacheState } as any
                );
            }
        } finally {
            this.currentCancel = null;
            this.currentRowId = null;
        }
    }

    /**
     * Cancels the in-flight copy only if it belongs to the given row. Cancelling unconditionally would abort
     * an unrelated copy and leave its row stuck in the `copying` state.
     *
     * Resolves once the cancelled copy has settled (its streams closed and its own cleanup done), so callers
     * can safely delete the cache folder afterwards. Never rejects: `copy` reports its own errors.
     */
    protected async cancelIfCurrent ( rowId : string ) : Promise<void> {
        if ( this.currentRowId != null && this.currentRowId === String( rowId ) ) {
            const copy = this.currentCopy;

            this.currentCancel?.cancel();

            await copy?.catch( () => {} );
        }
    }

    resetInterruptedCopying () {
        return this.table.updateMany(
            query => query.where( { state: 'copying' } ),
            { state: 'queued' as MediaSourceCacheState } as any
        );
    }

    async populateSourceCache ( record : PlayableMediaRecord, cancel ?: CancelToken ) : Promise<MediaSourceDetails[]> {
        const sources = [ ...await this.server.providers.open( record.sources ) ];

        const cached : MediaSourceDetails[] = [];

        const folder = this.getCacheFolder( record );

        await this.makeDir( folder );

        const usedNames : Set<string> = new Set();

        for ( const source of sources ) {
            cancel?.throwIfCancellationRequested();

            await source.load();

            for ( const stream of source.streams ) {
                cancel?.throwIfCancellationRequested();

                const ext = stream.extension ?? mime.getExtension( stream.mime );

                let baseName = this.sanitizeFileName( stream.name );

                let fileName = `${ baseName }.${ ext }`;

                if ( usedNames.has( fileName ) ) {
                    const idSlice = String( stream.id ?? '' ).slice( 0, 8 );

                    baseName = `${ baseName }-${ idSlice }`;
                    fileName = `${ baseName }.${ ext }`;
                }

                usedNames.add( fileName );

                const dest = path.join( folder, fileName );

                await saveStreamTo( stream.open(), dest, cancel );

                cached.push( { ...source.details, id: dest, provider: 'file', single: true } );
            }
        }

        return cached;
    }

    protected async makeDir ( folder : string ) : Promise<void> {
        await new Promise<void>( ( resolve, reject ) => {
            mkdirp( folder, ( error : any ) => error ? reject( error ) : resolve() );
        } );
    }

    protected sanitizeFileName ( name : string ) : string {
        return String( name )
            .replace( /[\/\\:*?"<>|]/g, '_' )
            .replace( /[. ]+$/g, '' )
            .trim();
    }

    protected getCacheFolder ( record : PlayableMediaRecord ) : string {
        return this.server.storage.getPath( 'cache', 'media', record.kind, String( record.id ) );
    }

    protected deleteCacheFolder ( record : PlayableMediaRecord ) : Promise<void> {
        return this.deleteFolder( this.getCacheFolder( record ) );
    }

    protected async deleteFolder ( folder : string ) : Promise<void> {
        let entries : string[];
        try {
            entries = await fs.readdir( folder );
        } catch ( error : any ) {
            // Ignore missing folder
            if ( error?.code !== 'ENOENT' ) {
                this.server.logger.error( `media-cache`, `Could not read cache folder ${ folder }`, error );
            }
            return;
        }

        for ( const entry of entries ) {
            const file = path.join( folder, entry );

            try {
                await fs.unlink( file );
            } catch ( error : any ) {
                this.server.logger.error( `media-cache`, `Could not delete cache file ${ file }`, error );
            }
        }

        try {
            await fs.rmdir( folder );
        } catch ( error : any ) {
            this.server.logger.error( `media-cache`, `Could not delete cache folder ${ folder }`, error );
        }
    }

    protected async findRow ( ref : MediaSourceRef ) : Promise<MediaSourceCacheRecord | null> {
        return this.table.findOne(
            query => query.where( { mediaId: ref.id, mediaKind: ref.kind } )
        );
    }

    protected async findRows ( refs : MediaSourceRef[] ) : Promise<MediaSourceCacheRecord[]> {
        if (refs.length == 0) {
            return [];
        }

        const refsByKind = collect( refs, groupingBy( item => item.kind, mapping( item => item.id ) ) );

        return this.table.find(
            query => {
                for ( const [kind, ids] of refsByKind.entries() ) {
                    query = query.orWhere(subQuery =>
                        subQuery.where('mediaKind', kind).whereIn('mediaId', ids));
                }
                return query;
            }
        );
    }

    /**
     * Expand any non-playable refs (show/season) into their descendant episode refs,
     * using MediaManager.getPlayables. Dedupes across inputs.
     *
     * Playable kinds (movie/episode/custom) pass through unchanged.
     */
    protected async expandRefs ( refs : MediaSourceRef[] ) : Promise<MediaSourceRef[]> {
        const seen : Set<string> = new Set();
        const out : MediaSourceRef[] = [];

        for ( const ref of refs ) {
            const playables = await this.server.media.getPlayables( ref.kind, ref.id );

            for ( const playable of playables ) {
                const key = `${ playable.kind }:${ playable.id }`;

                if ( !seen.has( key ) ) {
                    seen.add( key );

                    out.push( { kind: playable.kind, id: playable.id } );
                }
            }
        }

        return out;
    }

    async clearSourceCacheFiles ( record : PlayableMediaRecord ) : Promise<void> {
        await this.server.database.tables.mediaSourcesCache.deleteMany(
            query => query.where( { mediaId: record.id, mediaKind: record.kind } )
        );

        await this.deleteCacheFolder( record );
    }

    async enqueue ( refs : MediaSourceRef[], options : { force ?: boolean, state ?: 'queued' | 'paused' } = {} ) : Promise<MediaSourceCacheRecord[]> {
        refs = await this.expandRefs( refs );

        const force = options?.force ?? false;
        const targetState = options?.state ?? 'queued';

        // Load every existing row up front (chunked to stay below the SQL variables limit) instead of
        // issuing one query per ref: a single show can expand into hundreds of episodes
        const existingByKey : Map<string, MediaSourceCacheRecord> = new Map();

        for ( const refsChunk of chunk( refs, 500 ) ) {
            for ( const row of await this.findRows( refsChunk ) ) {
                existingByKey.set( `${ row.mediaKind }:${ row.mediaId }`, row );
            }
        }

        const toCreate : Partial<MediaSourceCacheRecord>[] = [];
        const toForce : string[] = [];
        const toReactivate : string[] = [];

        for ( const ref of refs ) {
            const existing = existingByKey.get( `${ ref.kind }:${ ref.id }` );

            if ( existing == null ) {
                toCreate.push( {
                    mediaId: ref.id,
                    mediaKind: ref.kind,
                    state: targetState,
                    sources: null,
                    error: null,
                    lastAttemptAt: null
                } );
            } else if ( existing.state === 'ready' || existing.state === 'queued' || existing.state === 'copying' ) {
                // Else leave ready/queued/copying rows untouched
                if ( force ) {
                    toForce.push( String( existing.id ) );
                }
            } else {
                // failed/paused → queued (enqueue always reactivates, regardless of targetState,
                // since an explicit enqueue is a user intent to cache the media)
                toReactivate.push( String( existing.id ) );
            }
        }

        await this.server.database.connection.transaction( async transaction => {
            await this.table.createMany( toCreate as MediaSourceCacheRecord[], { transaction } );

            for ( const ids of chunk( toForce, 500 ) ) {
                await this.table.updateMany(
                    query => query.whereIn( 'id', ids ),
                    { state: 'queued' as MediaSourceCacheState, error: null, sources: null } as any,
                    Infinity, { transaction }
                );
            }

            for ( const ids of chunk( toReactivate, 500 ) ) {
                await this.table.updateMany(
                    query => query.whereIn( 'id', ids ).whereIn( 'state', [ 'failed', 'paused' ] as MediaSourceCacheState[] ),
                    { state: 'queued' as MediaSourceCacheState, error: null } as any,
                    Infinity, { transaction }
                );
            }
        } );

        // If a copy of a force-requeued record is in-flight, cancel it so the requeue takes effect
        // No need to wait for it to settle: nothing is deleted here
        for ( const id of toForce ) {
            void this.cancelIfCurrent( id );
        }

        // Only wake the worker if at least one row is actually queued.
        // If only paused rows were added, the worker would skip them anyway (see pickNextQueued).
        const producedQueued = toForce.length > 0
            || toReactivate.length > 0
            || ( toCreate.length > 0 && targetState === 'queued' );

        if ( producedQueued ) {
            this.start();
        }

        return this.list();
    }

    async trigger ( refs : MediaSourceRef[] ) : Promise<MediaSourceCacheRecord[]> {
        refs = await this.expandRefs( refs );

        const rows = await this.findRows( refs );

        const ids = rows
            .filter( row => row.state === 'failed' || row.state === 'paused' )
            .map( row => String( row.id ) );

        if ( ids.length > 0 ) {
            const updatedCount = await this.table.updateMany(
                query => query.whereIn( 'id', ids ).whereIn( 'state', [ 'failed', 'paused' ] as MediaSourceCacheState[] ),
                { state: 'queued' as MediaSourceCacheState, error: null as any } as any
            );

            if ( updatedCount > 0 ) {
                this.start();
            }
        }

        return this.list();
    }

    async remove ( refs : MediaSourceRef[] ) : Promise<MediaSourceCacheRecord[]> {
        refs = await this.expandRefs( refs );

        // Load all the cache rows with the associated media records
        const rows = await this.table.relations.record.applyAll(
            await this.findRows( refs )
        );

        for ( const existing of rows ) {
            await this.table.delete( String( existing.id ) );

            // Stop writing into the folder (and wait for the files to be closed) before deleting it
            await this.cancelIfCurrent( existing.id );

            if ( existing.record != null ) {
                await this.deleteCacheFolder( existing.record );
            }
        }

        return this.list();
    }

    async list () : Promise<MediaSourceCacheRecord[]> {
        return this.table.find();
    }

    async awake () : Promise<MediaSourceCacheRecord[]> {
        this.start();

        return this.list();
    }
}
