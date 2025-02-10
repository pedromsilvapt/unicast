import { MediaRecord } from "../MediaRecord";
import { Config } from "../Config";
import { UnicastServer } from '../UnicastServer';
import { ChildProcess, spawn } from 'child_process';
import { Future } from '@pedromsilva/data-future';
import { PolyRelationMap } from './Relations/PolyRelation';
import { Hook } from '../Hookable';
import { AsyncStream } from 'data-async-iterators';
import { ComposedTask } from '../BackgroundTask';
import type { Relation } from './Relations/Relation';
import { LoggerInterface } from 'clui-logger';
import knex from 'knex';
import { inspect } from 'util';

import { BaseTable, ChangeHistoryTable, ChangeHistory } from './Tables/BaseTable';
export { BaseTable, ChangeHistoryTable, ChangeHistory };

import { AbstractMediaTable } from './Tables/AbstractMediaTable';
export { AbstractMediaTable };

import { MediaTable, GlobalMediaRecord } from './Tables/MediaTable';
export { MediaTable, GlobalMediaRecord };

import { MoviesMediaTable, MovieMediaRecord } from './Tables/MoviesMediaTable';
export { MoviesMediaTable, MovieMediaRecord };

import { TvShowsMediaTable, TvShowMediaRecord } from './Tables/TvShowsMediaTable';
export { TvShowsMediaTable, TvShowMediaRecord };

import { TvSeasonsMediaTable, TvSeasonMediaRecord } from './Tables/TvSeasonsMediaTable';
export { TvSeasonsMediaTable, TvSeasonMediaRecord };

import { TvEpisodesMediaTable, TvEpisodeMediaRecord } from './Tables/TvEpisodesMediaTable';
export { TvEpisodesMediaTable, TvEpisodeMediaRecord };

import { CustomMediaTable, CustomMediaRecord } from './Tables/CustomMediaTable';
export { CustomMediaTable, CustomMediaRecord };

import { PlaylistsTable, PlaylistRecord } from './Tables/PlaylistsTable';
export { PlaylistsTable, PlaylistRecord };

import { PlaylistsMediaTable, PlaylistMediaRecord } from './Tables/PlaylistsMediaTable';
export { PlaylistsMediaTable, PlaylistMediaRecord };

import { HistoryTable, HistoryRecord } from './Tables/HistoryTable';
export { HistoryTable, HistoryRecord };

import { CollectionsTable, CollectionRecord, CollectionTreeRecord, TreeIterationOrder } from './Tables/CollectionsTable';
export { CollectionsTable, CollectionRecord, CollectionTreeRecord, TreeIterationOrder };

import { CollectionMediaTable, CollectionMediaRecord } from './Tables/CollectionMediaTable';
export { CollectionMediaTable, CollectionMediaRecord };

import { UserRanksTable, UserRankRecord } from './Tables/UserRanksTable';
export { UserRanksTable, UserRankRecord };

import { StorageTable, StorageRecord   } from './Tables/StorageTable';
export { StorageTable, StorageRecord };

import { JobsQueueTable, JobRecord } from './Tables/JobsQueueTable';
export { JobsQueueTable, JobRecord };

import { PeopleTable, PersonRecord } from './Tables/PeopleTable';
export { PeopleTable, PersonRecord };

import { MediaCastTable, MediaCastRecord } from './Tables/MediaCastTable';
export { MediaCastTable, MediaCastRecord };

import { SubtitlesTable, SubtitleRecord } from './Tables/SubtitlesTable';
import { MediaProbesTable } from './Tables/MediaProbesTable';
export { SubtitlesTable, SubtitleRecord };

export class DatabaseKnexLogger {
    protected logger : LoggerInterface;

    public constructor ( logger : LoggerInterface ) {
        this.logger = logger;
    }

    protected messageToString( message : string | Array<{sql: string, bindings: any[]}> | {sql: string, bindings: any[]} ) : string {
        if ( message == null ) {
            return "null";
        }

        if ( typeof message === 'string' ) {
            return message;
        }

        if ( message instanceof Array ) {
            return message.map( subMsg => this.messageToString( subMsg ) ).join( '; ' );
        }

        return message.sql + ' % (' + message.bindings.join( ', ' ) + ')';
    }

    warn = ( message ) => {
        this.logger.warn( this.messageToString( message ) );
    }

    error = ( message ) => {
        this.logger.error( this.messageToString( message ) );
    }

    deprecate = ( message ) => {
        this.logger.warn( 'DEPRECATED: ' + this.messageToString( message ) );
    }

    debug = ( message ) => {
        this.logger.debug( this.messageToString( message ) );
    }
}

export class Database {
    server : UnicastServer;

    config : Config;

    connection : knex.Knex;

    tables : DatabaseTables;

    logger: LoggerInterface;

    knexLogger: DatabaseKnexLogger;

    protected installedFuture : Future<void> = new Future();

    installed : Promise<void> = this.installedFuture.promise;

    onInstall : Hook<void>;

    constructor ( server : UnicastServer, config : Config = null ) {
        this.server = server;

        if ( !server.hooks.has( 'database/install' ) ) {
            this.onInstall = server.hooks.create<void>( 'database/install' );
        }

        this.config = config || server.config;

        this.logger = this.server.logger.service( 'database/sql' );
        this.knexLogger = new DatabaseKnexLogger( this.logger );

        this.connection = knex( {
            ...this.config.get<knex.Knex.Config>( 'database' ),
            log: this.knexLogger
        } );

        this.connection.on( 'query-error', ( error, query ) => {
            this.logger.error( error + '\n' + query );
        });

        this.tables = new DatabaseTables( this );
    }

    async install () {
        try {
            // Make sure to run any migrations needed
            await this.connection.migrate.latest();

            await this.tables.install();

            if ( this.onInstall != null ) {
                await this.onInstall.notify();
            }

            this.installedFuture.resolve();
        } catch ( err ) {
            this.installedFuture.reject( err );
        }
    }

    async repair () {
        const task = new ComposedTask();

        await task.run( 'movies', () => this.tables.movies.repair() );

        await task.run( 'shows', () => this.tables.shows.repair() );

        await task.run( 'collections', () => this.tables.collections.repair() );

        await task.run( 'collectionsMedia', () => this.tables.collectionsMedia.repair() );

        await task.run( 'custom', () => this.tables.custom.repair() );

        await task.run( 'playlists', () => this.tables.playlists.repair() );

        await task.run( 'history', () => this.tables.history.repair() );

        await task.run( 'people', () => this.tables.people.repair() );

        await task.run( 'mediaCast', () => this.tables.mediaCast.repair() );

        return task;
    }

    /**
     * Returns a database object representing a different database.
     *
     * @param options
     * @returns
     */
    for ( options: string | knex.Knex.Config ) : Database {
        if ( typeof options === 'string' ) {
            options = {
                connection: {
                    filename: options
                }
            } as knex.Knex.Config;
        }

        const newConfig = Config.merge( [
            this.config.clone(),
            Config.create( { database: options } ),
        ] );

        return new Database( this.server, newConfig );
    }

    /**
     * Clones the currently used database into the database provided in
     * the argument destination.
     *
     * @param destination
     * @param logger
     * @returns
     */
    async clone ( destination : Database | knex.Knex.Config | string, logger ?: LoggerInterface, transformer?: ( tableName: string ) => ( row: any ) => any ) {
        if ( !( destination instanceof Database ) ) {
            destination = this.for( destination );
        }

        throw new Error(`Not yet implemented`);
    }
}

export class DatabaseTables {
    media : MediaTable;

    movies : MoviesMediaTable;

    shows : TvShowsMediaTable;

    seasons : TvSeasonsMediaTable;

    episodes : TvEpisodesMediaTable;

    custom : CustomMediaTable;

    probes : MediaProbesTable;

    history : HistoryTable;

    playlists : PlaylistsTable;

    playlistsMedia : PlaylistsMediaTable;

    collections : CollectionsTable;

    collectionsMedia : CollectionMediaTable;

    userRanks : UserRanksTable;

    people : PeopleTable;

    mediaCast : MediaCastTable;

    subtitles : SubtitlesTable;

    jobsQueue : JobsQueueTable;

    storage : StorageTable;

    constructor ( database : Database ) {
        this.media = new MediaTable( database );

        this.movies = new MoviesMediaTable( database );

        this.shows = new TvShowsMediaTable( database );

        this.seasons = new TvSeasonsMediaTable( database );

        this.episodes = new TvEpisodesMediaTable( database );

        this.custom = new CustomMediaTable( database );

        this.probes = new MediaProbesTable( database );

        this.history = new HistoryTable( database );

        this.playlists = new PlaylistsTable( database );

        this.playlistsMedia = new PlaylistsMediaTable( database );

        this.collections = new CollectionsTable( database );

        this.collectionsMedia = new CollectionMediaTable( database );

        this.userRanks = new UserRanksTable( database );

        this.people = new PeopleTable( database );

        this.mediaCast = new MediaCastTable( database );

        this.subtitles = new SubtitlesTable( database );

        this.jobsQueue = new JobsQueueTable( database );

        this.storage = new StorageTable( database );
    }

    async install () {
        await this.movies.install();

        await this.shows.install();

        await this.seasons.install();

        await this.episodes.install();

        await this.custom.install();

        await this.probes.install();

        await this.history.install();

        await this.playlists.install();

        await this.playlistsMedia.install();

        await this.collections.install();

        await this.collectionsMedia.install();

        await this.userRanks.install();

        await this.people.install();

        await this.mediaCast.install();

        await this.subtitles.install();

        await this.jobsQueue.install();

        await this.storage.install();
    }

    tables ( includeHistory: boolean = false ): BaseTable<any>[] {
        return [
            this.movies,
            this.shows,
            this.seasons,
            this.episodes,
            this.custom,
            this.probes,
            this.history,
            this.playlists,
            this.collections,
            this.collectionsMedia,
            this.userRanks,
            this.people,
            this.mediaCast,
            this.subtitles,
            this.jobsQueue,
            this.storage,
        ].flatMap( table => {
            if ( includeHistory ) {
                return [ table, table.changesHistory ];
            } else {
                return [ table ];
            }
        } );
    }

    get ( name: string ) : BaseTable<any> {
        if ( name in this && this[ name ] instanceof BaseTable ) {
            return this[ name ];
        }

        for ( let table of this.tables() ) {
            if ( table.tableName == name ) {
                return table;
            }
        }

        throw new Error( `Could not find a table named "${name}".` );
    }
}

export class DatabaseTransaction {
    protected parentTransaction : DatabaseTransaction | knex.Knex.Transaction;

    protected get raw () : knex.Knex.Transaction {
        if ( this.parentTransaction instanceof DatabaseTransaction ) {
            return this.parentTransaction.raw;
        } else {
            return this.parentTransaction;
        }
    }

    public constructor ( parent : DatabaseTransaction | knex.Knex.Transaction ) {
        this.parentTransaction = parent;
    }

    public async commit () : Promise<void> {
        throw new Error('Not yet implemented.');
    }
}

export interface IndexSchema {
    name : string;
    columns ?: string | string[];
}

export function createMediaRecordPolyMap ( tables : DatabaseTables ) : PolyRelationMap<MediaRecord> {
    return {
        'movie': tables.movies,
        'show': tables.shows,
        'season': tables.seasons,
        'episode': tables.episodes,
        'custom': tables.custom
    };
}

export class RelationsQuery<R extends {id?: string}, T extends BaseTable<R>> {
    protected table : T;

    protected relations : Relation<R, any>[];

    constructor ( table: T, relations: Relation<R, any>[] ) {
        this.table = table;
        this.relations = relations;
    }

    async apply ( record : R ) {
        for ( let rel of this.relations ) {
            await rel.apply( record );
        }
    }

    async applyAll ( records : R[] ) {
        for ( let rel of this.relations ) {
            await rel.applyAll( records );
        }
    }

    applyStream ( records : AsyncIterable<R>, pageSize : number = 100 ) : AsyncStream<R> {
        return new AsyncStream( records ).chunkEvery( pageSize ).tap( records => this.applyAll( records ) ).flatten();
    }

    findStream<T extends R> ( query ?: ( query : knex.Knex.QueryBuilder ) => knex.Knex.QueryBuilder ) {
        return this.applyStream( this.table.findStream<T>( query ) );
    }
}

export class Debounce {
    protected action : Function;

    protected delay : number;

    protected timeout : NodeJS.Timer;

    constructor ( action : Function, delay : number = 0 ) {
        this.action = action;
        this.delay = delay;
    }

    touch () {
        if ( this.timeout ) {
            clearTimeout( this.timeout );

            this.timeout = null;
        }

        this.timeout = setTimeout( () => this.action(), this.delay );
    }
}
