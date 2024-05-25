import { AsyncIterableLike, AsyncStream, backlog, chunk, sep, toArray } from 'data-async-iterators';
import { Config } from '../../Config';
import * as rethink from '../../Database/DatabaseRethink';
import * as sql from '../../Database/Database';
import { Tool, ToolOption, ToolValueType } from "../Tool";
import { MediaKind, MediaRecord, MovieMediaRecord, PersonRecord, TvSeasonMediaRecord, TvShowMediaRecord, isCustomRecord, isMovieRecord, isTvEpisodeRecord, isTvSeasonRecord, isTvShowRecord } from '../../MediaRecord';
import * as r from "rethinkdb";
import * as knex from "knex";
import { LiveLoggerInterface, pp } from 'clui-logger';
import { collect, filtering, groupingBy, first, mapping, Comparator } from 'data-collectors';
import { fs } from 'mz';
import * as path from 'path';
import { AsyncBreaker } from '../../ES2017/AsyncBreaker';

export interface RethinkdbToSqlOptions {
    source : string;
    target : string;
    dryRun : boolean;
}

export class RethinkdbToSqlTool extends Tool<RethinkdbToSqlOptions> {
    protected tableColumns = new Map<sql.BaseTable<any>, Record<string, knex.Knex.ColumnInfo>>();
    
    protected liveLogger : LiveLoggerInterface;
    
    getOptions () {
        return [
            new ToolOption( 'source' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( 'databaseRethink' ),
            new ToolOption( 'target' ).setRequired( false ).setType( ToolValueType.String ).setDefaultValue( 'database' ),
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async findMissingColumns( srcTable : rethink.BaseTable<any>, columns : string[] ): Promise<Map<string, number>> {
        const missingColumns = new Map();
        
        for await ( const row of srcTable.findStream() ) {
            for ( const column of Object.keys( row ) ) {
                if ( !columns.includes( column ) ) {
                    missingColumns.set( column, ( missingColumns.get( column ) ?? 0 ) + 1 );
                }
            }
        }
        
        return missingColumns;
    }
    
    async run ( options : RethinkdbToSqlOptions ) {
        this.liveLogger = this.logger.live();
        
        const srcConfig = this.server.config.get( options.source );
        const dstConfig = this.server.config.get( options.target );
        
        const src = new rethink.Database( this.server, Config.create( { databaseRethink: srcConfig } ) );
        const dst = new sql.Database( this.server, Config.create( { database: dstConfig } ) );
        
        await src.install();
        await dst.install();
        
        for ( const tableName of Object.keys( src.tables ) ) {
            const srcTable = src.tables.get( tableName );
            const dstTable = dst.tables.get( tableName );
            
            const sqliteColumns = await dstTable.connection.table( dstTable.tableName ).columnInfo();
            this.log(`Table ${ dstTable.tableName } Columns: ` + Object.keys( sqliteColumns ).join(', '));
            
            this.tableColumns.set( dstTable, sqliteColumns );
            
            const missingColumns = await this.findMissingColumns( srcTable, Object.keys( sqliteColumns ) );
            if ( missingColumns.size > 0 ) {
                for ( const [ key, count ] of missingColumns.entries() ) {
                    this.logger.error(` Missing column ${ key } ${ count } times` );
                }
            }
        }
        
        const mediaTableAliases = {
            [MediaKind.Custom]: dst.tables.custom.tableName,
            [MediaKind.Movie]: dst.tables.movies.tableName,
            [MediaKind.TvShow]: dst.tables.shows.tableName,
            [MediaKind.TvSeason]: dst.tables.seasons.tableName,
            [MediaKind.TvEpisode]: dst.tables.episodes.tableName,
        };
        
        const internalIdentifiers = new IdentifierMapping( mediaTableAliases );
        const identifiers = new IdentifierMapping( mediaTableAliases );
        
        const mediaSorter = ( a : MediaRecord, b : MediaRecord ) : number => {
            const aDate = ( a as any ).addedAt ?? a.createdAt;
            const bDate = ( b as any ).addedAt ?? b.createdAt;
            
            return aDate - bDate;
        };
        const mediaTables: rethink.BaseTable<MediaRecord>[] = [
            src.tables.custom,
            src.tables.movies,
            src.tables.shows,
            src.tables.seasons,
            src.tables.episodes,
        ];
        let allMediaRecords = await AsyncStream.fromArray( mediaTables ).flatMap( table => table.findStream() ).toArray();
        allMediaRecords.sort( mediaSorter );
        allMediaRecords = topologicalSortMediaRecords( allMediaRecords );
        
        const tvShowsById  = collect( allMediaRecords, filtering( r => isTvShowRecord( r ), groupingBy( r => r.id, first() ) ) ) as Map<string, TvShowMediaRecord>;
        const tvSeasonsById = collect( allMediaRecords, filtering( r => isTvSeasonRecord( r ), groupingBy( r => r.id, first() ) ) ) as Map<string, TvSeasonMediaRecord>;
        
        const hangingSeasons = collect( allMediaRecords, filtering( r => isTvSeasonRecord( r ) && !tvShowsById.has( r.tvShowId ) ) ).length
        const hangingSeasonEpisodes = collect( allMediaRecords, filtering( r => isTvEpisodeRecord( r ) && tvSeasonsById.has( r.tvSeasonId ) && !tvShowsById.has( tvSeasonsById.get( r.tvSeasonId ).tvShowId ) ) ).length;
        const hangingEpisodes = collect( allMediaRecords, filtering( r => isTvEpisodeRecord( r ) && !tvSeasonsById.has( r.tvSeasonId ) ) ).length;
        
        this.logger.info( pp`Found ${ hangingSeasons } hanging seasons (with ${ hangingSeasonEpisodes } recursive hanging episodes) and ${ hangingEpisodes } hanging episodes.` );

        const breaker = new AsyncBreaker();
        
        // Dedup duplicate internal ids
        for ( const record of allMediaRecords ) {
            if ( record.internalId == null ) {
                continue;
            }
            
            if ( internalIdentifiers.has( record.kind, record.internalId ) ) {
                const originalId = internalIdentifiers.get( record.kind, record.internalId );
                
                this.logger.warn(pp`Found duplicate internal id ${ record.internalId } for record ${ record.kind } ${ record.id }, deduping with ${ originalId }`);
            } else {
                internalIdentifiers.set( record.kind, record.internalId, record.id );
            }
        }
        
        allMediaRecords = allMediaRecords.filter( rec => rec.internalId == null || internalIdentifiers.get( rec.kind, rec.internalId ) == rec.id );
        
        // Pre-Allocate the ids for all media records
        const mediaIds = await dst.tables.media.createMany( allMediaRecords.map( rec => ( { kind: rec.kind } ) ) );
        
        for ( const [ record, id ] of allMediaRecords.map( ( rec, i ) => [ rec, mediaIds[ i ].id ] as const ) ) {
            identifiers.set( record.kind, record.id, id );
        }
        
        for ( const record of allMediaRecords ) {
            record.id = identifiers.get( record.kind, record.id );
            
            if ( isTvSeasonRecord( record ) )  {
                record.tvShowId = identifiers.get( MediaKind.TvShow, record.tvShowId );
                record.tvShowKind = MediaKind.TvShow;
            } else if ( isTvEpisodeRecord( record ) ) {
                record.tvSeasonId = identifiers.get( MediaKind.TvSeason, record.tvSeasonId );
                record.tvSeasonKind = MediaKind.TvSeason;
            }
        }
        
        // Insert the media records into their respective tables
        const mediaByKind = collect( allMediaRecords, groupingBy( rec => rec.kind ) );
        
        await this.createRecords( dst.tables.movies, mediaByKind.get( MediaKind.Movie ) );
        await this.createRecords( dst.tables.shows, mediaByKind.get( MediaKind.TvShow ) );
        await this.createRecords( dst.tables.seasons, mediaByKind.get( MediaKind.TvSeason ) );
        await this.createRecords( dst.tables.episodes, mediaByKind.get( MediaKind.TvEpisode ) );
        await this.createRecords( dst.tables.custom, mediaByKind.get( MediaKind.Custom ) );
        
        const baseSorter = <M extends { createdAt: Date } >( a : M, b : M ) : number => {
            return a.createdAt.getTime() - b.createdAt.getTime();
        };
        
        // Migrate people
        const people = await src.tables.people.findStream().toArray();
        await this.createRecords( dst.tables.people, people, identifiers );
        
        // Migrate mediaCast
        let mediaCast = await src.tables.mediaCast.findStream().toArray();
        for ( const cast of mediaCast ) {
            cast.personId = identifiers.tryGet( src.tables.people.tableName, cast.personId );
            cast.mediaId = identifiers.tryGet( cast.mediaKind, cast.mediaId );
        }
        mediaCast = mediaCast.filter(cast => cast.personId != null && cast.mediaId != null);
        
        await this.createRecords( dst.tables.mediaCast, mediaCast, identifiers );
        
        // Migrate playlists
        const playlists = await src.tables.playlists.findStream().toArray();
        let playlistMedia = playlists
            .flatMap( playlist => playlist.references.map( ( item, index ) => ( {
                playlistId: playlist.id,
                mediaId: item.id,
                mediaKind: item.kind,
                order: index,
                createdAt: playlist.createdAt,
                updatedAt: playlist.createdAt,
            } as sql.PlaylistMediaRecord ) ) ?? [] );
        
        await this.createRecords( dst.tables.playlists, playlists, identifiers );
            
        // Migrate playlistsMedia
        for ( const item of playlistMedia ) {
            item.playlistId = identifiers.tryGet( dst.tables.playlists.tableName, item.playlistId );
            item.mediaId = identifiers.tryGet( item.mediaKind, item.mediaId );
        }
        playlistMedia = playlistMedia.filter(item => item.playlistId != null);
        
        await this.createRecords( dst.tables.playlistsMedia, playlistMedia );
        
        // Migrate jobs
        const jobs = await src.tables.jobsQueue.findStream().toArray();
        await this.createRecords( dst.tables.jobsQueue, jobs, identifiers );
        
        // Migrate subtitles
        const subtitles = await src.tables.subtitles.findStream().toArray();
        for ( const item of subtitles ) {
            // Same object as `item`, just with a different type to make typescript pleased
            const sqlItem = ( item as unknown as sql.SubtitleRecord );
            
            sqlItem.mediaId = identifiers.tryGet( ( item as any ).reference.kind, ( item as any ).reference.id );
            sqlItem.mediaKind = ( item as any ).reference.kind;
            
            delete ( item as any ).reference;
        }
        await this.createRecords( dst.tables.subtitles, subtitles as any, identifiers );
        
        // Migrate userRanks
        const ranks = await src.tables.userRanks.findStream().toArray();
        for ( const item of ranks ) {
            // Same object as `item`, just with a different type to make typescript pleased
            const sqlItem = ( item as unknown as sql.UserRankRecord );
            
            sqlItem.mediaId = identifiers.tryGet( item.reference.kind, item.reference.id );
            sqlItem.mediaKind = item.reference.kind;
            
            delete item.reference;
        }
        await this.createRecords( dst.tables.userRanks, ranks as any, identifiers );
        
        // Migrate history
        const history = await src.tables.history.findStream().toArray();
        for ( const item of history ) {
            // Same object as `item`, just with a different type to make typescript pleased
            const sqlItem = ( item as unknown as sql.HistoryRecord );
            
            sqlItem.playlistId = identifiers.tryGet( dst.tables.playlists.tableName, item.playlist );
            sqlItem.mediaId = identifiers.tryGet( item.reference.kind, item.reference.id );
            sqlItem.mediaKind = item.reference.kind;
            
            delete item.reference;
            delete item.playlist;
        }
        this.logger.info( pp`  > Found ${ history.filter( it => ( it as unknown as sql.HistoryRecord ).mediaId == null ).length } history records (out of ${history.length}) with no matching record id` );
        
        await this.createRecords( dst.tables.history, history as any, identifiers );
        
        // Migrate collections
        const collections = await src.tables.collections.findStream().toArray();
        
        for ( var collection of topologicalSortGeneric( collections, c => c.id, c => c.parentId != null ? [ c.parentId ] : [] ) ) {
            if ( collection.parentId != null ) {
                collection.parentId = identifiers.get( dst.tables.collections.tableName, collection.parentId );
            }
            
            await this.createRecords( dst.tables.collections, [ collection ], identifiers );
        }
        
        // Migrate collectionMedia
        const collectionsMedia = await src.tables.collectionsMedia.findStream().toArray();
        for ( const item of collectionsMedia ) {
            item.collectionId = identifiers.get( dst.tables.collections.tableName, item.collectionId );
            item.mediaId = identifiers.get( item.mediaKind, item.mediaId );
        }
        
        await this.createRecords( dst.tables.collectionsMedia, collectionsMedia, identifiers );
        
        // Migrate storage
        const storage = await src.tables.storage.findStream().toArray();
        for ( const kv of storage ) {
            if ( kv.key.startsWith( "media." ) ) {
                for ( const key of Object.keys( kv.value ) ) {
                    const preset = kv.value[ key ];
                    
                    if ( preset?.filters?.collections != null ) {
                        const collectionIds = Object.keys( preset.filters.collections );
                        const newPresetCollections = {};
                        
                        for ( const collectionId of collectionIds ) {
                            newPresetCollections[ identifiers.get( dst.tables.collections.tableName, collectionId ) ] = preset.filters.collections[ collectionId ];
                        }
                        
                        preset.filters.collections = newPresetCollections;
                    }
                }
            }
        }
        await this.createRecords( dst.tables.storage, storage, identifiers );
        
        // Repair the database
        this.logger.info(pp`Performing repair of database`);
        await dst.repair();
        
        // Save Identifier Records
        const migrationId: number = Date.now();
        
        const identifiersPath: string = this.server.storage.getPath('migration', `identifiers-${migrationId}.csv`);
        
        this.logger.info(pp`Saving identifiers into file ${identifiersPath}`);
        const identifiersString: string = `Table,OldId,NewId\n` + 
            Array.from(identifiers.entries()).map(entry => [entry.table, entry.oldId, entry.newId].join(',') + '\n').join('');
            
        if (!await fs.exists(path.dirname(identifiersPath))) {
            await fs.mkdir(path.dirname(identifiersPath));
        }
        await fs.writeFile( identifiersPath, identifiersString );
    }
    
    recordsCreateStats: {
        count: number;
        table: string;
    } | null = null;
    
    public async createRecords<R extends { id ?: string }> ( table : sql.BaseTable<R>, records : R[], identifiers : IdentifierMapping | null = null ) : Promise<void> {
        if ( this.recordsCreateStats?.table == table.tableName ) {
            this.recordsCreateStats.count += records.length;
        } else {
            if ( this.recordsCreateStats != null ) {
                this.liveLogger.close();
                this.liveLogger = this.logger.live();
            }
            
            this.recordsCreateStats = {
                count: records.length,
                table: table.tableName,
            };
        }
        
        this.liveLogger.info(pp`Inserting ${ this.recordsCreateStats.count } records into the table ${ this.recordsCreateStats.table }`);
        
        const tableColumns = await table.connection.table( table.tableName ).columnInfo();;
        
        let oldIds: string[] = null;
        
        if ( identifiers != null ) {
            oldIds = records.map( r => r.id );
        }
        
        for ( const newRecord of records ) {
            if ( identifiers != null ) {
                delete newRecord.id;
            }
            
            for ( const key of Object.keys( newRecord ) ) {
                if ( !( key in tableColumns ) ) {
                    delete newRecord[ key ];
                }
            }
        }
        
        await table.connection.transaction(async trx => {
            await table.createMany( records, { transaction: trx } );
        });
        
        if ( identifiers != null ) {
            for ( let i = 0; i < records.length; i++ ) {
                identifiers.set( table.tableName, oldIds[ i ], records[ i ].id );
            }
        }
    }
}

const IDENTIFIER_HASH_SEPARATOR = '<$>';

class IdentifierMapping {
    public identifierMapping = new Map<string, string>();
    
    public tableAliases = new Map<string, string>();
    
    public constructor ( tableAliases : Record<string, string> = null ) {
        if ( tableAliases != null ) {
            for ( const alias of Object.keys( tableAliases ) ) {
                this.tableAliases.set( alias, tableAliases[ alias ] );
            }
        }
    }
    
    public * entries () : IterableIterator<{table: string, oldId: string, newId: string}> {
        for (const [hash, newId] of this.identifierMapping.entries()) {
            const [table, ...oldIdParts] = hash.split(IDENTIFIER_HASH_SEPARATOR);
            const oldId = oldIdParts.join(IDENTIFIER_HASH_SEPARATOR);
            
            yield { table, oldId, newId };
        }
    }
    
    public getHash ( table : string, id : string ) {
        table = this.tableAliases.get( table ) ?? table;
        
        return `${table}${IDENTIFIER_HASH_SEPARATOR}${id}`;
    }
    
    public get ( table : string, id : string ) : string {
        const newId = this.tryGet( table, id );
        
        if ( newId == null ) {
            throw new Error( `Identifier mapping not found for ${ table } id '${ id }'` );
        }
        
        return newId;
    }
    
    
    public tryGet ( table : string, id : string ) : string {
        const hash = this.getHash( table, id );
        
        const newId = this.identifierMapping.get( hash );
        
        return newId;
    }
    
    public has ( table : string, id : string ) : boolean {
        const hash = this.getHash( table, id );
        
        return this.identifierMapping.has( hash );
    }
    
    public set ( table : string, id : string, newId : string ) {
        if ( newId == null ) {
            throw new Error( "Argument 'id' cannot be null." );
        }
        
        const hash = this.getHash( table, id );
        
        if ( this.identifierMapping.has( hash ) ) {
            throw new Error( `Cannot set the same identifier ${ table } '${ id }' twice.` );
        }
        
        this.identifierMapping.set( hash, newId );
    }
}

export function topologicalSortGeneric<R, K>( items : R[], keyer : ( item : R ) => K, resolver : ( item : R ) => K[] ) : R[] {
    const visitedSet = new Set<R>();
    
    const recordsByKey = collect( items, groupingBy( r => keyer( r ), first() ) );
    
    const result: R[] = [];
    
    const appendRecord = ( record : R ) : void => {
        if ( visitedSet.has( record ) ) {
            return;
        }
        
        visitedSet.add( record );
        
        const deps = resolver( record );
        
        if ( deps != null && deps.length > 0 ) {
            for ( const dep of deps ) {
                if ( !recordsByKey.has( dep ) ) {
                    throw new Error( `Could not find topological parent with key ${ dep }` );
                }
                
                appendRecord( recordsByKey.get( dep ) );
            }
        }
        
        result.push( record );
    };
    
    for ( const record of items ) {
        appendRecord( record );
    }
    
    return result;
}

export function topologicalSortMediaRecords<M extends MediaRecord>( stableSortedRecords : M[] ) : M[] {
    const visitedSet = new Set<MediaRecord>();
    
    const recordsByHash = collect( stableSortedRecords, groupingBy( r => r.kind, groupingBy( r => r.id, first() ) ) );
    
    const result = [];
    
    const getMediaRecordDependencies = ( record : MediaRecord ) : M[] | null => {
        if ( isTvSeasonRecord( record ) ) {
            return [ recordsByHash.get( MediaKind.TvShow )?.get( record.tvShowId ) ];
        } else if ( isTvEpisodeRecord( record ) ) {
            return [ recordsByHash.get( MediaKind.TvSeason )?.get( record.tvSeasonId ) ];
        } else {
            return null;
        }
    };
    
    const appendRecord = ( record : MediaRecord ) : void => {
        if ( visitedSet.has( record ) ) {
            return;
        }
        
        visitedSet.add( record );
        
        const deps = getMediaRecordDependencies( record );
        
        if ( deps != null && deps.length > 0 ) {
            for ( const dep of deps ) {
                appendRecord( dep );
            }
        }
        
        result.push( record );
    };
    
    for ( const record of stableSortedRecords ) {
        appendRecord( record );
    }
    
    return result;
}
