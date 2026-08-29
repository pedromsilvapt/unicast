import { Route, ValidateBody, ValidateQuery } from "../../BaseController";
import { Request, Response } from "restify";
import { MediaSourceCacheRecord, MediaSourcesCacheTable } from '../../../Database/Database';
import { MediaSourceRef } from "../../../MediaSourcesCache/MediaSourceCacheManager";
import {
    MediaKind,
    PlayableMediaRecord,
    TvEpisodeMediaRecord,
    isTvEpisodeRecord,
    MediaRecord, createRecordsSet, createRecordsMap
} from '../../../MediaRecord';
import * as schema from '@gallant/schema';
import { BaseTableController, TableListQuerySchema } from "../../BaseTableController";

export interface LoadedMediaSourceCacheRecord extends MediaSourceCacheRecord {
    record : MediaRecord;
}

export class MediaSourcesCacheController extends BaseTableController<MediaSourceCacheRecord> {
    sortingFields : string[] = [ 'state', 'mediaKind', 'mediaId', 'createdAt' ];

    defaultSortField : string = 'createdAt';

    searchFields : string[] = [];

    get table () : MediaSourcesCacheTable {
        return this.server.database.tables.mediaSourcesCache;
    }

    protected getRequestScope ( req : Request ) : MediaSourceRef | null {
        const kind = req.query?.scope?.kind as MediaKind | undefined;
        const id = req.query?.scope?.id as string | undefined;

        if ( kind == null || id == null ) {
            return null;
        }

        return { kind, id };
    }

    protected async transformAllScoped ( scope : MediaSourceRef, rows : MediaSourceCacheRecord[], includeRecords : boolean ) : Promise<MediaSourceCacheRecord[]> {
        const scopedRecords = await this.server.media.getPlayables( scope.kind, scope.id );

        const rowsMap = createRecordsMap<MediaSourceCacheRecord>();
        for ( const row of rows ) {
            rowsMap.get( row.mediaKind ).set( row.mediaId, row );
        }

        const scopedRows : MediaSourceCacheRecord[] = [];

        for ( const record of scopedRecords ) {
            let row = rowsMap.get( record.kind ).get( record.id );

            if ( row == null ) {
                row = {
                    id: null,
                    createdAt: null,
                    updatedAt: null,
                    mediaId: record.id,
                    mediaKind: record.kind,
                    state: 'not-cached' as any,
                    sources: null,
                    error: null,
                    lastAttemptAt: null
                };
            }

            if ( includeRecords ) {
                ( row as LoadedMediaSourceCacheRecord ).record = record;
            }

            scopedRows.push( row );
        }

        return scopedRows;
    }

    async transformAll ( req : Request, res : Response, rows : MediaSourceCacheRecord[] ) : Promise<any> {
        rows = await super.transformAll( req, res, rows );

        const scope = this.getRequestScope( req );
        const includeRecords = req.query.records === 'true';

        if ( scope != null ) {
            rows = await this.transformAllScoped( scope, rows, includeRecords );
        }

        if ( includeRecords ) {
            // Avoid loading the records twice, since when scoped, we already do that
            if ( scope == null ) {
                await this.table.relations.record.applyAll( rows );
            }

            // Cast the rows (cannot use the return of "applyAll" because it is only called conditionally
            const loadedRows = rows as LoadedMediaSourceCacheRecord[];

            // For episode rows, resolve season → show using the table relations (batched, no per-row queries).
            const episodeRecords = loadedRows
                .filter( row => row.record != null && isTvEpisodeRecord( row.record ) )
                .map( row => row.record as TvEpisodeMediaRecord );

            if ( episodeRecords.length > 0 ) {
                const episodesTable = this.server.database.tables.episodes;
                const seasonsTable = this.server.database.tables.seasons;

                const loadedEpisodes = await episodesTable.relations.season.applyAll( episodeRecords );

                const seasonRecords = loadedEpisodes.map( ep => ep.tvSeason );
                await seasonsTable.relations.show.applyAll( seasonRecords );
            }

            // Inject cachedArtwork for each record.
            const url = this.server.getMatchingUrl( req );

            for ( const row of loadedRows ) {
                if ( row.record != null ) {
                    ( row.record as any ).cachedArtwork = this.server.artwork.getCachedObject(
                        url, row.record.kind, row.record.id, row.record.art
                    )
                }
            }
        }

        return rows;
    }

    @ValidateQuery( schema.parse( `{
        skip?: number;
        take?: number;
        filterSort?: string | {
            field: string;
            direction?: "asc" | "desc";
            list?: string;
        };
        records?: string;
        scope?: {
            kind: string;
            id: string;
        };
    }`, schema.createDefaultOptions( { defaultNumberStrict: false, defaultBooleanStrict: false } ) ) )
    async list ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        return super.list( req, res );
    }

    @ValidateBody( schema.parse( `{
        items: { kind: string, id: string }[];
        state?: 'queued' | 'paused';
    }` ) )
    @Route( 'post', '/queue' )
    async queue ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        const force = req.query.force === 'true';

        const items = ( req.body.items ?? [] ) as MediaSourceRef[];

        const state = req.body.state as 'queued' | 'paused' | undefined;

        const rows = await this.server.mediaSourcesCache.enqueue( items, { force, state } );

        return await this.runTransforms( req, res, rows );
    }

    @ValidateBody( schema.parse( `{
        items: { kind: string, id: string }[];
    }` ) )
    @Route( 'post', '/trigger' )
    async trigger ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        const items = ( req.body.items ?? [] ) as MediaSourceRef[];

        const rows = await this.server.mediaSourcesCache.trigger( items );

        return await this.runTransforms( req, res, rows );
    }

    @ValidateBody( schema.parse( `{
        items: { kind: string, id: string }[];
    }` ) )
    @Route( 'post', '/queue/remove' )
    async remove ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        const items = ( req.body.items ?? [] ) as MediaSourceRef[];

        const rows = await this.server.mediaSourcesCache.remove( items );

        return await this.runTransforms( req, res, rows );
    }

    @Route( 'post', '/awake' )
    async awake ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        const rows = await this.server.mediaSourcesCache.awake();

        return await this.runTransforms( req, res, rows );
    }

    @ValidateBody( schema.parse( `{
        onlyAfterCurrent?: boolean
    }` ) )
    @Route( 'post', '/stop' )
    async stop ( req : Request, res : Response ) : Promise<MediaSourceCacheRecord[]> {
        const onlyAfterCurrent = req.body?.onlyAfterCurrent === true;

        this.server.mediaSourcesCache.stop( onlyAfterCurrent );

        const rows = await this.server.mediaSourcesCache.list();

        return await this.runTransforms( req, res, rows );
    }
}
