import {isPlayableRecord, MediaKind, PlayableMediaRecord} from '../MediaRecord';
import { UnicastServer } from '../UnicastServer';
import { CancelToken, CancelledError } from 'data-cancel-token';
import { MediaSourceDetails } from '../MediaProviders/MediaSource';
import { MediaSourceCacheRecord, MediaSourceCacheState } from '../Database/Database';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as mime from 'mime';
import * as mkdirp from 'mkdirp';
import { saveStreamTo } from '../ArtworkCache';
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

    afterCurrentCancel : CancelToken | null = null;

    constructor ( server : UnicastServer ) {
        this.server = server;
        this.logger = this.server.logger.service( "media-cache" );
    }

    get table () {
        return this.server.database.tables.mediaSourcesCache;
    }

    start () {
        // Clear any pending stop request even if the worker is still running: a graceful stop followed by
        // start/enqueue while the current copy is in flight must keep the worker going afterwards.
        this.afterCurrentCancel = null;

        if ( this.running ) return;

        this.resetInterruptedCopying().then( () => this.run() );
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

                const record = await this.server.media.get( row.mediaKind, row.mediaId ) as PlayableMediaRecord;

                const repoName = record.repository;

                if ( repoName ) {
                    const repo = this.server.repositories.get( repoName );

                    if ( repo && !( await repo.isMediaReachable( record ) ) ) {
                        await this.table.update( String( row.id ), {
                            state: 'paused',
                            lastAttemptAt: new Date(),
                            error: 'Repository offline'
                        } as any );

                        continue;
                    }
                }

                await this.copy( row, record );
            }
        } finally {
            this.running = false;
        }
    }

    protected async pickNextQueued () : Promise<MediaSourceCacheRecord | null> {
        return this.table.findOne(
            query => query.where( { state: 'queued' } ).orderBy( 'createdAt', 'asc' )
        );
    }

    protected async copy ( row : MediaSourceCacheRecord, record : PlayableMediaRecord ) {
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
     */
    protected cancelIfCurrent ( rowId : string ) {
        if ( this.currentRowId != null && this.currentRowId === String( rowId ) ) {
            this.currentCancel?.cancel();
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

    protected async deleteCacheFolder ( record : PlayableMediaRecord ) : Promise<void> {
        const folder = this.getCacheFolder( record );

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

        let producedQueued = false;

        for ( const ref of refs ) {
            const existing = await this.findRow( ref );

            if ( existing == null ) {
                await this.table.create( {
                    mediaId: ref.id,
                    mediaKind: ref.kind,
                    state: targetState,
                    sources: null,
                    error: null,
                    lastAttemptAt: null
                } as any );

                if ( targetState === 'queued' ) {
                    producedQueued = true;
                }
            } else if ( existing.state === 'ready' || existing.state === 'queued' || existing.state === 'copying' ) {
                if ( force ) {
                    await this.table.update( String( existing.id ), {
                        state: 'queued',
                        error: null,
                        sources: null
                    } as any );

                    // If a copy of this record is in-flight, cancel it so the requeue takes effect
                    this.cancelIfCurrent( existing.id );

                    producedQueued = true;
                }
                // Else leave ready/queued/copying rows untouched
            } else {
                // failed/paused → queued (enqueue always reactivates, regardless of targetState,
                // since an explicit enqueue is a user intent to cache the media)
                await this.table.update( String( existing.id ), {
                    state: 'queued',
                    error: null
                } as any );

                producedQueued = true;
            }
        }

        // Only wake the worker if at least one row is actually queued.
        // If only paused rows were added, the worker would skip them anyway (see pickNextQueued).
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

            // Stop writing into the folder before deleting it
            this.cancelIfCurrent( existing.id );

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
