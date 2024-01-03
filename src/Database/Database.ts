import * as r from 'rethinkdb';
import * as Case from 'case';
import { MovieMediaRecord, TvShowMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, CustomMediaRecord, MediaKind, MediaRecord, PersonRecord, MediaCastRecord } from "../MediaRecord";
import { Semaphore } from 'data-semaphore';
import { Config } from "../Config";
import { IDatabaseLocalSubtitle } from '../Subtitles/SubtitlesRepository';
import * as itt from 'itt';
import { UnicastServer } from '../UnicastServer';
import { ChildProcess, spawn } from 'child_process';
import { Future } from '@pedromsilva/data-future';
import { ManyToManyPolyRelation } from './Relations/ManyToManyPolyRelation';
import { PolyRelationMap } from './Relations/PolyRelation';
import { ManyToManyRelation } from './Relations/ManyToManyRelation';
import { HasManyRelation } from './Relations/OneToManyRelation';
import { BelongsToOneRelation } from './Relations/OneToOneRelation';
import { BelongsToOnePolyRelation } from './Relations/OneToOnePolyRelation';
import { Hook } from '../Hookable';
import * as equals from 'fast-deep-equal';
import { toArray, AsyncStream } from 'data-async-iterators';
import { collect, groupingBy, first, mapping, toSet } from 'data-collectors';
import { ComposedTask } from '../BackgroundTask';
import { DotNode, expandDotStrings, Relatable, tableChainDeep } from './RelationGraph';
import type { Relation } from './Relations/Relation';
import { LoggerInterface } from 'clui-logger';

export type RethinkPredicate = r.ExpressionFunction<boolean> | r.Expression<boolean> | { [key: string]: any };

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

export class Database {
    server : UnicastServer;

    config : Config;

    connections : ConnectionPool;

    tables : DatabaseTables;

    daemon : DatabaseDaemon;

    protected installedFuture : Future<void> = new Future();

    installed : Promise<void> = this.installedFuture.promise;

    onInstall : Hook<void>;

    constructor ( server : UnicastServer, config : Config = null ) {
        this.server = server;

        if ( !server.hooks.has( 'database/install' ) ) {
            this.onInstall = server.hooks.create<void>( 'database/install' );
        }

        this.config = config || server.config;

        this.connections = new ConnectionPool( this );

        this.tables = new DatabaseTables( this.connections );

        if ( this.config.get( 'database.autostart.enable' ) ) {
            this.daemon = new DatabaseDaemon( server );
        }
    }

    async connect () : Promise<r.Connection> {
        if ( this.daemon ) {
            await this.daemon.start();
        }

        return r.connect( this.config.get<r.ConnectionOptions>( 'database' ) );
    }

    async install () {
        try {
            const databaseName : string = this.config.get<string>( 'database.db' );

            const conn = await this.connections.acquire();

            try {
                const databases = await r.dbList().run( conn );

                if ( !databases.includes( databaseName ) ) {
                    await r.dbCreate( databaseName ).run( conn );
                }

                await ( r.db( databaseName ) as any ).wait().run( conn );

                await this.tables.install();

                if ( this.onInstall != null ) {
                    await this.onInstall.notify();
                }

                await ( r.db( databaseName ) as any ).wait().run( conn );
            } finally {
                await this.connections.release( conn );
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
     * Returns a database object representing a local RethinkDB database.
     *
     * @param dbname
     * @returns
     */
    for ( dbname : string ) : Database {
        const newConfig = Config.merge( [
            this.config.clone(),
            Config.create( { database: { db: dbname, autostart: { enable: false } } } ),
        ] );

        return new Database( this.server, newConfig );
    }

    /**
     * Returns a database object representing a remote RethinkDB database.
     *
     * @param options
     * @returns
     */
    forRemote ( options: r.ConnectionOptions ) : Database {
        const newConfig = Config.merge( [
            this.config.clone(),
            Config.create( { database: { ...options, autostart: { enable: false } } } ),
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
    async clone ( destination : Database | string, logger ?: LoggerInterface, transformer?: ( tableName: string ) => ( row: any ) => any ) {
        if ( typeof destination === 'string' ) {
            destination = this.for( destination );
        }

        let srcConnection: r.Connection = null;
        let dstConnection: r.Connection = null;

        logger ??= this.server.logger.service( 'Database' ).service( 'Clone' );

        try {
            const srcConfig = this.config.get<r.ConnectionOptions>( 'database', {} );
            const dstConfig = destination.config.get<r.ConnectionOptions>( 'database', {} );

            // Is true when both connections (source and destination) point to
            // the same RethinkDB instance
            const isLocalClone: boolean = srcConfig.host == dstConfig.host
                && srcConfig.port == dstConfig.port
                && srcConfig.user == dstConfig.user
                && srcConfig.password == dstConfig.password;

            const srcDbName = srcConfig.db;
            const dstDbName = dstConfig.db;

            // Validate that the databases are different
            if ( isLocalClone && srcDbName == dstDbName ) {
                logger.error( `Cannot clone a database onto itself: ${ srcDbName } and ${ dstDbName } are equal.` );
                return;
            }

            // Notify the user of the operation in progress and give some time to cancel it
            logger.info(`Begining attempt to clone database ${ srcDbName } onto ${ dstDbName }. Holding 5 seconds before proceeding...`);

            await new Promise<void>( resolve => setTimeout( resolve, 5000 ) );

            // Acquire source connection
            logger.debug( `Attempt to acquire source DB connection...` );
            srcConnection = await this.connections.acquire();
            logger.debug( `Source DB connection acquired!` );

            // Acquire destination connection
            logger.debug( `Attempt to acquire destination DB connection...` );
            dstConnection = await destination.connections.acquire();
            logger.debug( `Destination DB connection acquired!` );

            logger.debug( `Retrieving list of databases...` );
            const databases = await r.dbList().run( dstConnection );
            logger.debug( `List retrieved, ${ databases.length } databases found!` );

            // Drop Destination DB if it exists (wa want to clone from scratch)
            if ( databases.includes( dstDbName ) ) {
                try {
                    logger.info( `Destination database ${ dstDbName } already exists. Attempting to drop...` );
                    await r.dbDrop( dstDbName ).run( dstConnection );
                    logger.info( `Destination database ${ dstDbName } dropped successfully!` );
                } catch ( err ) {
                    logger.warn( `ERROR (while dropping destination db): ${ err.message }` );
                    logger.info( `Proceeding with clone despite previous error.` );
                }
            }

            // Create the Destination DB empty
            logger.info( `Attempting to create destination database ${ dstDbName }...` );
            await r.dbCreate( dstDbName ).run( dstConnection );
            logger.info( `Destination database ${ dstDbName } created successfully!` );

            // Create all the tables from the Source Database in the Destination Database
            const srcTables = await r.db( srcDbName ).tableList().run( srcConnection );

            logger.info(`Beginning to create ${srcTables.length} tables on the destination database...`);
            for ( const tableName of srcTables ) {
                logger.info(`Beginning to create table ${tableName} on the destination database...`);
                const primaryKey = await r.db( srcDbName ).table( tableName )["info"]()('primary_key').run( srcConnection );

                await r.db( dstDbName ).tableCreate( tableName, { primaryKey: primaryKey } as any ).run( dstConnection );
            }
            logger.info(`All ${srcTables.length} tables created successfully!`);

            // Create secondary indexes for all the tables
            logger.info(`Beginning to create secondary indexes on the destination database...`);
            for ( const tableName of srcTables ) {
                logger.info(`Beginning to create secondary indexes for table ${tableName} on the destination database...`);

                let sourceIndexes = await r.db( srcDbName ).table( tableName ).indexList().run( srcConnection );

                for (let index of sourceIndexes) {
                    let indexObj = (await r.db( srcDbName ).table( tableName )["indexStatus"]( index ).run(srcConnection))[0];

                    await (r.db( dstDbName ).table( tableName ).indexCreate as any)(
                        indexObj.index, indexObj.function, { geo: indexObj.geo, multi: indexObj.multi } as any
                    ).run( dstConnection );
                }

                logger.info(`Waiting for secondary indexes on table ${tableName} to be ready...`);

                await r.db( dstDbName ).table( tableName ).indexWait().run( dstConnection );
            }
            logger.info(`All secondary indexes created successfully!`);

            logger.info(`Beginning to copy table contents to the destination database...`);
            for ( const tableName of srcTables ) {
                logger.info(`Copying table ${ tableName }...`);

                const tableTransformer = transformer?.(tableName);

                // If there is no transformer set for this table, we copy the
                // data directly: it is faster this way
                // Both databases must also reside on the same RethinkDB instance
                if ( tableTransformer == null && isLocalClone ) {
                    await r.db( dstDbName ).table( tableName ).insert(
                        r.db( srcDbName ).table( tableName )
                    ).run( dstConnection );
                } else {
                    const cursor = await r.db( srcDbName ).table( tableName ).run( srcConnection );

                    let hasNext = true;

                    try {
                        while (hasNext) {
                            const chunk: any[] = [];

                            const chunkSize = 100;

                            try {
                                while ( chunk.length < chunkSize ) {
                                    const row = await ( cursor.next as () => Promise<any> )();

                                    if ( tableTransformer != null ) {
                                        chunk.push( tableTransformer( row ) );
                                    } else {
                                        chunk.push( row );
                                    }
                                }
                            } catch ( error ) {
                                if ( !( error.name === "ReqlDriverError" && error.message === "No more rows in the cursor." ) ) {
                                    throw error;
                                } else {
                                    hasNext = false;
                                }
                            }

                            if ( chunk.length > 0 ) {
                                await r.db( dstDbName ).table( tableName ).insert( chunk ).run( dstConnection );
                            }
                        }
                    } finally {
                        cursor.close();
                    }
                }

                logger.info(`Table ${ tableName } copied!`);
            }
            logger.info(`All table's data copied!`);

            logger.info(`Clone operation has succeeded. Releasing resources and wrapping up!`);
        } catch ( err ) {
            logger.error( err.message || err );

            throw err;
        } finally {
            if ( srcConnection != null ) {
                this.connections.release( srcConnection );
            }

            if ( dstConnection != null ) {
                destination.connections.release( dstConnection );
            }
        }
    }
}

export class DatabaseTables {
    movies : MoviesMediaTable;

    shows : TvShowsMediaTable;

    seasons : TvSeasonsMediaTable;

    episodes : TvEpisodesMediaTable;

    custom : CustomMediaTable;

    history : HistoryTable;

    playlists : PlaylistsTable;

    collections : CollectionsTable;

    collectionsMedia : CollectionMediaTable;

    userRanks : UserRanksTable;

    people : PeopleTable;

    mediaCast : MediaCastTable;

    subtitles : SubtitlesTable;

    jobsQueue : PersistentQueueTable<JobRecord>;

    storage : StorageTable;

    constructor ( pool : ConnectionPool ) {
        this.movies = new MoviesMediaTable( pool );

        this.shows = new TvShowsMediaTable( pool );

        this.seasons = new TvSeasonsMediaTable( pool );

        this.episodes = new TvEpisodesMediaTable( pool );

        this.custom = new CustomMediaTable( pool );

        this.history = new HistoryTable( pool );

        this.playlists = new PlaylistsTable( pool );

        this.collections = new CollectionsTable( pool );

        this.collectionsMedia = new CollectionMediaTable( pool );

        this.userRanks = new UserRanksTable( pool );

        this.people = new PeopleTable( pool );

        this.mediaCast = new MediaCastTable( pool );

        this.subtitles = new SubtitlesTable( pool );

        this.jobsQueue = new PersistentQueueTable( pool );

        this.storage = new StorageTable( pool );
    }

    async install () {
        await this.movies.install();

        await this.shows.install();

        await this.seasons.install();

        await this.episodes.install();

        await this.custom.install();

        await this.history.install();

        await this.playlists.install();

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

        throw new Error( `Could not find a table named "${name}".` );
    }
}

export class ConnectionPool {
    database : Database;

    freeConnections : ConnectionResource[] = [];

    usedConnections : Map<r.Connection, ConnectionResource> = new Map;

    maxConnections : number = 100;

    maxConnectionUsage : number = 300;

    maxConnectionWait : number = 2000;

    semaphore : Semaphore;

    closing : Future<void> = null;

    constructor ( db : Database ) {
        this.database = db;

        this.semaphore =  new Semaphore( this.maxConnections );
    }

    protected async createConnection () : Promise<ConnectionResource> {
        return {
            connection: await this.database.connect(),
            usageCount: 0,
            inUse: false,
            release: null,
            timeout: null
        };
    }

    protected async destroyConnection ( connection : ConnectionResource ) : Promise<void> {
        const index = this.freeConnections.indexOf( connection );

        if ( index >= 0 ) {
            this.freeConnections.splice( index, 1 );
        }

        if ( connection.connection.open ) {
            await connection.connection.close();
        }
    }

    async acquire () : Promise<r.Connection> {
        if ( this.closing && this.usedConnections.size == 0 ) {
            return new Promise<r.Connection>( () => {} );
        }

        const release = await this.semaphore.acquire();

        let conn : ConnectionResource;

        while ( this.freeConnections.length && !conn ) {
            conn = this.freeConnections.pop();

            if ( !conn.connection.open ) {
                this.destroyConnection( conn );
            }
        }

        conn = conn || await this.createConnection();

        if ( conn.timeout ) {
            clearTimeout( conn.timeout );
        }

        conn.usageCount += 1;

        conn.inUse = true;

        conn.release = release;

        this.usedConnections.set( conn.connection, conn );

        return conn.connection;
    }

    release ( connection : r.Connection ) : void {
        if ( this.usedConnections.has( connection ) ) {
            const resource = this.usedConnections.get( connection );

            this.usedConnections.delete( connection );

            resource.inUse = false;

            if ( this.closeCheck() )  {
                this.destroyConnection( resource );

                this.closing.resolve();
            } else if ( resource.usageCount <= this.maxConnectionUsage && this.maxConnectionWait > 0 ) {
                resource.timeout = setTimeout( () => this.destroyConnection( resource ), this.maxConnectionWait );

                this.freeConnections.push( resource );
            } else {
                this.destroyConnection( resource );
            }

            resource.release();
        }
    }

    async test () {
        try {
            const connection = await this.acquire();
            this.release(connection);

            return true;
        } catch ( error ) {
            this.database.server.onError.notify( error );
            return false;
        }
    }

    closeCheck () {
        if ( this.closing && !this.semaphore.isLocked && this.usedConnections.size == 0 )  {
            for ( let conn of this.freeConnections ) {
                this.destroyConnection( conn );
            }

            return true;
        }
    }

    async close () {
        if ( this.closing ) {
            return this.closing.promise;
        }

        this.closing = new Future<void>();

        if ( this.closeCheck() ) {
            this.closing.resolve();
        }

        await this.closing.promise;

        this.closing = null;
    }
}

export interface ConnectionResource {
    connection : r.Connection;
    usageCount : number;
    inUse : boolean;
    timeout : NodeJS.Timer;
    release : Function;
}

export interface IndexSchema {
    name : string;
    expression ?: r.Expression<any> | r.Expression<any>[];
    options ?: { multi ?: boolean; geo ?: boolean; };
}

export abstract class BaseTable<R extends { id ?: string }> implements Relatable<R> {
    abstract readonly tableName : string;

    pool : ConnectionPool;

    indexesSchema : IndexSchema[] = [];

    dateFields : string[] = [];

    relations : Record<string, Relation<R, any>> = {};

    onCreate : Hook<R> = new Hook( 'onCreate' );

    onUpdate : Hook<R> = new Hook( 'onUpdate' );

    onDelete : Hook<R> = new Hook( 'onDelete' );

    changesHistoryEnabled : boolean = false;

    changesHistory : ChangeHistoryTable<R>;

    identifierFields : Array<string> = null;

    get database () : Database {
        return this.pool.database;
    }

    constructor ( pool : ConnectionPool ) {
        this.pool = pool;
    }

    query () : r.Table {
        return r.table( this.tableName );
    }

    async install () {
        const conn = await this.pool.acquire();

        try {
            const tables : string[] = await ( r as any ).tableList().run( conn );

            if ( !tables.includes( this.tableName ) ) {
                await ( r as any ).tableCreate( this.tableName ).run( conn );
            }
        } finally {
            await this.pool.release( conn );
        }

        await this.installIndexes();

        if ( this.changesHistoryEnabled && this.changesHistory != null ) {
            this.changesHistory = new ChangeHistoryTable( this.pool, this.tableName + '_history' );

            this.onCreate.subscribe( record => this.changesHistory.createChange( 'create', record ) );
            this.onUpdate.subscribe( record => this.changesHistory.createChange( 'update', record ) );
            this.onDelete.subscribe( record => this.changesHistory.createChange( 'delete', record ) );
        }

        if ( this.changesHistoryEnabled ) {
            await this.changesHistory.install();
        }
    }

    async installIndexes () {
        const conn = await this.pool.acquire();

        try {
            const indexes = await this.query().indexList().run( conn );

            for ( let index of this.indexesSchema ) {
                if ( indexes.includes( index.name ) ) {
                    continue;
                }

                if ( index.expression ) {
                    await ( this.query().indexCreate as any )( index.name, index.expression, index.options ).run( conn );
                } else {
                    await ( this.query().indexCreate as any )( index.name, index.options ).run( conn );
                }
            }

            await ( this.query() as any ).indexWait().run( conn );

            this.relations = this.installRelations( this.database.tables );
        } finally {
            await this.pool.release( conn );
        }
    }

    installRelations ( tables : DatabaseTables ) {
        return {};
    }

    tableChainDeep ( children: DotNode[] ) : Relation<any, any>[] {
        return tableChainDeep( this, children );
    }

    createRelationsQuery ( ...relations : string[] ) : RelationsQuery<R, this> {
        return new RelationsQuery( this, this.tableChainDeep( expandDotStrings( relations ) ) );
    }

    async get ( id : string ) : Promise<R> {
        if ( !id ) {
            return null;
        }

        const connection = await this.pool.acquire();

        try {
            const item = await this.query().get( id ).run( connection ) as any as Promise<R>;

            return item;
        } finally {
            this.pool.release( connection );
        }
    }

    async has ( id : string ) : Promise<boolean> {
        return ( await this.get( id ) ) != null;
    }

    async findAll ( keys : any[], opts : { index ?: string, query ?: ( query : r.Sequence ) => r.Sequence } = {} ) : Promise<R[]> {
        if ( keys.some( key => key === void 0 ) ) {
            keys = keys.filter( key => key !== void 0 );
        }

        if ( keys.length === 0 ) {
            return [];
        }

        const connection = await this.pool.acquire();

        try {
            let table = opts.index ?
                this.query().getAll( ( r as any ).args( keys ), { index: opts.index } ) :
                this.query().getAll( ( r as any ).args( keys ) );

            if ( opts.query ) {
                table = opts.query( table );
            }

            const cursor = await table.run( connection );

            const items = await cursor.toArray();

            await cursor.close();

            return items;
        } catch ( err ) {
            throw new Error( JSON.stringify( keys ) );
        } finally {
            await this.pool.release( connection );
        }
    }

    async run<T> ( query ?: ( query : r.Sequence ) => r.Expression<T> ) : Promise<T> {
        const connection = await this.pool.acquire();

        try {
            let table = this.query();

            let sequence : r.Expression<T> = query( table );

            return await sequence.run( connection );
        } finally {
            await this.pool.release( connection );
        }
    }

    async find<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T[]> {
        return toArray( this.findStream<T>( query ) );
    }

    protected async * findStreamIterator<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : AsyncIterableIterator<T> {
        const connection = await this.pool.acquire();

        try {
            let table = this.query();

            let sequence : r.Sequence = table;

            if ( query ) {
                sequence = query( table );
            }

            const cursor = await sequence.run( connection );

            try {
                while ( true ) {
                    yield await ( cursor.next as () => Promise<T> )();
                }
            } catch ( error ) {
                if ( !( error.name === "ReqlDriverError" && error.message === "No more rows in the cursor." ) ) {
                    throw error;
                }
            } finally {
                await cursor.close();
            }
        } finally {
            await this.pool.release( connection );
        }
    }

    findStream<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : AsyncStream<T> {
        return AsyncStream.dynamic( () => this.findStreamIterator( query ) );
    }

    async findOne<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T> {
        const results = await this.find<T>( subQuery => query ? query( subQuery ).limit( 1 ) : subQuery.limit( 1 ) );

        return results[ 0 ];
    }

    async count ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<number> {
        return this.run( sequence => {
            if ( query != null ) {
                sequence = query( sequence );
            }

            return sequence.count();
        } );
    }

    public getIdentifier ( record : R ) : string {
        if ( this.identifierFields == null || this.identifierFields.length == 0 ) {
            return null;
        }

        let identifier = '';

        for ( const field of this.identifierFields ) {
            identifier += '' + record[ field ];
        }

        if ( identifier.length > 0 ) {
            // Remove from the string anything that is invalid as an identifier:
            //  - every character at the start that is not [a-zA-Z_]
            //  - every character anywhere that is not [\w]
            return Case.pascal( identifier.replace(/(^[^a-zA-Z_])|[^\w]+/g, '-') );
        }

        return null;
    }

    public applyIdentifier ( record: R, clone: boolean = false ) : R {
        const identifier = this.getIdentifier( record );

        if ( identifier != null && identifier != record[ 'identifier' ] ) {
            // If requested, clone the source object before making any changes to it
            if ( clone ) {
                record = { ...record };
            }

            record[ 'identifier' ] = identifier;
        }

        return record;
    }

    async create ( record : R, options : Partial<r.OperationOptions> = {} ) : Promise<R> {
        const connection = await this.pool.acquire();

        try {
            for ( let field of Object.keys( record ) ) {
                if ( record[ field ] === void 0 ) {
                    record[ field ] = null;
                }
            }

            this.applyIdentifier( record );

            const res = await this.query().insert( record ).run( connection, { durability: 'hard', ...options } as r.OperationOptions );

            record.id = res.generated_keys[ 0 ];

            this.onCreate.notify( record );

            return record;
        } finally {
            this.pool.release( connection );
        }
    }

    async createMany ( recordsIter : Iterable<R>, options : Partial<r.OperationOptions> = {} ) : Promise<R[]> {
        const connection = await this.pool.acquire();

        const records = Array.from( recordsIter );

        try {
            for ( let record of records ) {
                for ( let field of Object.keys( record ) ) {
                    if ( record[ field ] === void 0 ) {
                        record[ field ] = null;
                    }
                }

                this.applyIdentifier( record );
            }

            const res = await this.query().insert( records ).run( connection, { durability: 'hard', ...options } as r.OperationOptions );

            let index = 0;

            for ( let record of records ) {
                if ( !record.id ) {
                    record.id = res.generated_keys[ index++ ];

                    this.onCreate.notify( record );
                }
            }

            return records;
        } finally {
            this.pool.release( connection );
        }
    }

    async update ( id : string, record : any, options : Partial<r.OperationOptions> = {} ) : Promise<R> {
        const connection = await this.pool.acquire();

        try {
            if ( record[ "id" ] != void 0 && id != record[ "id" ] ) {
                this.database.server.logger.error( 'database/' + this.tableName, 'TRYING TO CHANGE ID FFS OF RECORD ' + JSON.stringify( { ...record, id } ) + ' TO ' + record[ "id" ] );

                delete record[ "id" ];
            }

            for ( let field of Object.keys( record ) ) {
                if ( record[ field ] === void 0 ) {
                    record[ field ] = null;
                }
            }

            await this.query().get( id ).update( record ).run( connection, { durability: 'hard', ...options } as r.OperationOptions );

            if ( this.onUpdate.isSubscribed() ) {
                this.get( id ).then( updated => this.onUpdate.notify( updated ) );
            }

            return record;
        } finally {
            this.pool.release( connection );
        }
    }

    getLocalChanges ( baseRecord : object, changes : object ) : string[] {
        return Object.keys( changes ).filter( key => !equals( baseRecord[ key ], changes[ key ] ) );
    }

    isChanged ( baseRecord : object, changes : object ) : boolean {
        return Object.keys( changes ).some( key => !equals( baseRecord[ key ], changes[ key ] ) );
    }

    async updateIfChanged ( baseRecord : object, changes : object, conditionalChanges : object = null, options : Partial<r.OperationOptions> = {} ) : Promise<R> {
        if ( this.isChanged( baseRecord, changes ) ) {
            if ( conditionalChanges && typeof conditionalChanges == 'object' ) {
                changes = { ...changes, ...conditionalChanges };
            }

            if ( changes[ "id" ] != void 0 && baseRecord[ "id" ] != changes[ "id" ] ) {
                this.database.server.logger.error( 'database/' + this.tableName, 'TRYING TO CHANGE ID FFS OF RECORD ' + JSON.stringify( baseRecord ) + ' TO ' + changes[ "id" ] );

                delete changes[ "id" ];
            }

            await this.update( baseRecord[ "id" ], changes, options );
        }

        return baseRecord as R;
    }

    async updateMany ( predicate : RethinkPredicate, update : any, limit : number = Infinity, options : Partial<r.OperationOptions> = {} ) : Promise<number> {
        const connection = await this.pool.acquire();

        try {
            let query = this.query().filter( predicate );

            if ( limit && limit < Infinity ) {
                query = query.limit( limit );
            }

            let operation : r.WriteResult;

            if ( this.onUpdate.isSubscribed() ) {
                const ids : string[] = await query.run( connection )
                    .then( cursor => cursor.toArray() )
                    .then( records => records.map( r => r.id ) );

                operation = await this.query().getAll( ...ids ).update( update ).run( connection, { durability: 'hard', ...options } as r.OperationOptions );

                this.query().getAll( ...ids ).run( connection )
                    .then<R[]>( cursor => cursor.toArray() )
                    .then( async records => {
                        for ( let record of records ) {
                            await this.onUpdate.notify( record );
                        }
                    } );
            } else {
                operation = await query.update( update ).run( connection );
            }

            return operation.replaced;
        } finally {
            this.pool.release( connection );
        }
    }

    async delete ( id : string, options : Partial<r.OperationOptions> = {} ) : Promise<boolean> {
        const connection = await this.pool.acquire();

        try {
            let record : R = null;

            if ( this.onDelete.isSubscribed() ) {
                record = await this.get( id );
            }

            const operation = await this.query().get( id ).delete().run( connection, { durability: "hard", ...options } as r.OperationOptions );

            if ( record != null ) {
                this.onDelete.notify( record );
            }

            return operation.deleted > 0;
        } finally {
            this.pool.release( connection );
        }
    }

    async deleteKeys ( keys : any[], opts : { index ?: string, query ?: ( query : r.Sequence ) => r.Sequence } = {}, options : Partial<r.OperationOptions> = {} ) : Promise<number> {
        if ( keys.length === 0 ) {
            return 0;
        }

        const connection = await this.pool.acquire();

        try {
            let table = opts.index
                ? this.query().getAll( ( r as any ).args( keys ), { index: opts.index } )
                : this.query().getAll( ( r as any ).args( keys ) );

            if ( opts.query ) {
                table = opts.query( table );
            }

            let operation : r.WriteResult;

            if ( this.onDelete.isSubscribed() ) {
                const records : R[] = await table.run( connection )
                    .then( async cursor => {
                        const array = await cursor.toArray();

                        cursor.close();

                        return array;
                    } );

                const ids : string[] = records.map( r => r.id )

                operation = await this.query().getAll( ...ids ).delete().run( connection, { durability: 'hard', ...options } as r.OperationOptions );

                Promise.resolve( records ).then( async records => {
                    for ( let record of records ) {
                        await this.onDelete.notify( record );
                    }
                } );
            } else {
                operation = await table.delete().run( connection, { durability: 'hard', ...options } as r.OperationOptions );
            }

            return operation.deleted;
        } finally {
            await this.pool.release( connection );
        }
    }


    async deleteMany ( predicate : RethinkPredicate, limit : number = Infinity, options : Partial<r.OperationOptions> = {} ) : Promise<number> {
        const connection = await this.pool.acquire();

        try {
            let query = this.query().filter( predicate );

            if ( limit && limit < Infinity ) {
                query = query.limit( limit );
            }

            let operation : r.WriteResult;

            if ( this.onDelete.isSubscribed() ) {
                const records : R[] = await query.run( connection )
                    .then( async cursor => {
                        const array = await cursor.toArray();

                        cursor.close();

                        return array;
                    } );

                const ids : string[] = records.map( r => r.id )

                operation = await this.query().getAll( ...ids ).delete().run( connection, { durability: 'hard', ...options } as r.OperationOptions );

                Promise.resolve( records ).then( async records => {
                    for ( let record of records ) {
                        await this.onDelete.notify( record );
                    }
                } );
            } else {
                operation = await query.delete().run( connection, { durability: 'hard', ...options } as r.OperationOptions );
            }

            return operation.deleted;
        } finally {
            this.pool.release( connection );
        }
    }

    async deleteAll ( limit : number = Infinity, options : Partial<r.OperationOptions> = {} ) : Promise<number> {
        const connection = await this.pool.acquire();

        try {
            const res = await this.query().delete().run( connection, { durability: 'hard', ...options } as r.OperationOptions );

            return res.deleted;
        } finally {
            this.pool.release( connection );
        }
    }

    async repair ( records : string[] = null ) {
        if ( this.changesHistoryEnabled === true && this.changesHistory != null ) {
            if ( !records ) {
                records = ( await this.find() ).map( record => record.id );
            }

            await Promise.all( records.map( async id => {
                const createdRecords = await this.changesHistory.getForRecord( id, 'create' );

                if ( createdRecords.length === 0 ) {
                    const tableRecord = await this.get( id );

                    let date = new Date();

                    if ( 'createdAt' in tableRecord ) {
                        date = tableRecord[ 'createdAt' ] as Date;
                    }

                    await this.changesHistory.createChange( 'create', tableRecord, date );
                }
            } ) );
        }

        if ( this.dateFields != null && this.dateFields.length > 0 ) {
            if ( !records ) {
                records = ( await this.find() ).map( record => record.id );
            }

            await Promise.all( records.map( async id => {
                const record = await this.get( id );

                let changed = false;

                for( let field of this.dateFields ) {
                    if ( field in record && typeof record[ field ] === 'string' ) {
                        record[ field ] = new Date( record[ field ] );

                        changed = true;
                    }
                }

                if ( changed ) {
                    await this.update( record.id, record );
                }
            } ) );
        }
    }
}

export interface ChangeHistory<R> {
    id ?: string;
    action : 'create' | 'update' | 'delete';
    data : R;
    changedAt : Date;
}

export class ChangeHistoryTable<R> extends BaseTable<ChangeHistory<R>> {
    tableName: string;

    indexesSchema: IndexSchema[] = [
        { name: 'dataId', expression: r.row( 'data' )( 'id' ) },
        { name: 'createdAt' }
    ];

    public constructor ( pool: ConnectionPool, tableName: string ) {
        super( pool );

        this.tableName = tableName;
    }

    public async createChange ( action: 'create' | 'update' | 'delete', data: R, date?: Date ): Promise<ChangeHistory<R>> {
        const now = date ?? new Date();

        const change: ChangeHistory<R> = {
            action: action,
            data: data,
            changedAt: now,
        };

        return await this.create( change );
    }

    public async createManyChanges ( action: 'create' | 'update' | 'delete', datas: R[] ): Promise<ChangeHistory<R>[]> {
        const now = new Date();

        const changes: ChangeHistory<R>[] = datas.map( data => ({
            action: action,
            data: data,
            changedAt: now,
        }));

        return await this.createMany( changes );
    }

    public async getForRecord ( id : string, action ?: 'create' | 'update' | 'delete' ) : Promise<ChangeHistory<R>[]> {
        if ( action != null ) {
            return this.findAll( [ id ], {
                index: 'dataId',
                query: query => query.filter( { action } ),
            } );
        }

        return this.findAll( [ id ], {
            index: 'dataId'
        } );
    }
}

export interface MediaTableForeignKeys {
    [ kind : string ]: MediaKind;
}

export abstract class MediaTable<R extends MediaRecord> extends BaseTable<R> {
    protected readonly abstract kind : MediaKind;

    baseline : Partial<R> = {};

    foreignMediaKeys : MediaTableForeignKeys = {};

    declare relations : {
        collections: ManyToManyRelation<R, CollectionRecord>,
        cast: ManyToManyRelation<R, PersonRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            collections: new ManyToManyRelation( 'collections', tables.collectionsMedia, tables.collections, 'mediaId', 'collectionId' ).poly( 'mediaKind', this.kind ),
            cast: new ManyToManyRelation( 'cast', tables.mediaCast, tables.people, 'mediaId', 'personId' ).savePivot( 'cast' ).pivotIndexedBy( 'reference' ).poly( 'mediaKind', this.kind )
        };
    }

    async repair ( records : string[] = null ) {
        if ( !records ) {
            records = ( await this.find() ).map( record => record.id );
        }

        await super.repair( records );

        const collections = collect( await this.database.tables.collections.find(), groupingBy( coll => coll.id, first() ) );

        await Promise.all( records.map( async id => {
            const record = await this.get( id );

            const recordCollections = await this.database.tables.collectionsMedia.findAll( [ [ record.kind, record.id ] ], { index: 'reference' } );

            const collectionsCount : Set<string> = new Set();

            for ( let relation of recordCollections ) {
                // Remove any relations linkind to a non-existing collection or duplicated collections
                if ( !collections.has( relation.collectionId ) || collectionsCount.has( relation.collectionId ) ) {
                    await this.database.tables.collectionsMedia.delete( relation.id );
                }

                collectionsCount.add( relation.collectionId );
            }
        } ) );
    }
}

export class MoviesMediaTable extends MediaTable<MovieMediaRecord> {
    readonly tableName : string = 'media_movies';

    readonly kind : MediaKind = MediaKind.Movie;

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'title' },
        { name: 'rating' },
        { name: 'runtime' },
        { name: 'parentalRating' },
        { name: 'year' },
        { name: 'lastPlayedAt' },
        { name: 'playCount' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
        { name: 'qualityResolutions', expression: r.row( 'quality' )( 'resolution' ) },
        { name: 'qualitySources', expression: r.row( 'quality' )( 'source' ) },
        { name: 'qualityColorGamuts', expression: r.row( 'quality' )( 'colorGamut' ) },
    ];

    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    declare relations : {
        collections: ManyToManyRelation<MovieMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<MovieMediaRecord, PersonRecord>
    };

    baseline : Partial<MovieMediaRecord> = {
        watched: false,
        lastPlayedAt: null,
        playCount: 0,
        transient: false
    }

    async repair ( movies : string[] = null ) {
        if ( !movies ) {
            movies = ( await this.find() ).map( movie => movie.id );
        }

        await super.repair( movies );

        await Promise.all( movies.map( async movieId => {
            const movie = await this.get( movieId );

            const changes = {
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( movie ),
            }

            await this.updateIfChanged( movie, changes );

            Object.assign( movie, changes );
        } ) );
    }
}

export class TvShowsMediaTable extends MediaTable<TvShowMediaRecord> {
    readonly tableName : string = 'media_tvshows';

    readonly kind : MediaKind = MediaKind.TvShow;

    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    baseline : Partial<TvShowMediaRecord> = {
        watched: false,
        watchedEpisodesCount: 0,
        episodesCount: 0,
        seasonsCount: 0,
        transient: false
    };

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'title' },
        { name: 'seasonsCount' },
        { name: 'rating' },
        { name: 'parentalRating' },
        { name: 'year' },
        { name: 'lastPlayedAt' },
        { name: 'playCount' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
    ];

    declare relations : {
        collections: ManyToManyRelation<TvShowMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvShowMediaRecord, PersonRecord>,
        seasons: HasManyRelation<TvShowMediaRecord, TvSeasonMediaRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            seasons: new HasManyRelation( 'seasons', tables.seasons, 'tvShowId' ).indexBy( 'tvShowId' ).orderBy( 'number' )
        };
    }

    async repairEpisodesCount ( show : string | TvShowMediaRecord, seasons : TvSeasonMediaRecord[] = null ) : Promise<Partial<TvShowMediaRecord>> {
        if ( typeof show === 'string' ) {
            show = await this.get( show );
        }

        seasons = seasons ?? await this.relations.seasons.load( show );

        const seasonsCount = seasons.length;

        const episodesCount = itt( seasons ).map( season => season.episodesCount ).sum();

        const watchedEpisodesCount = itt( seasons ).map( season => season.watchedEpisodesCount ).sum();

        return {
            watched: episodesCount == watchedEpisodesCount,
            seasonsCount, episodesCount, watchedEpisodesCount
        };
    }

    async repairRepositoryPaths ( show : string | TvShowMediaRecord, seasons : TvSeasonMediaRecord[] = null ) : Promise<Partial<TvShowMediaRecord>> {
        if ( typeof show === 'string' ) {
            show = await this.get( show );
        }

        seasons = seasons ?? await this.relations.seasons.load( show );

        const repositoryPaths : string[] = [];

        for ( let season of seasons ) {
            if ( season.repositoryPaths instanceof Array ) {
                for ( let path of season.repositoryPaths ) {
                    if ( !repositoryPaths.includes( path ) ) {
                        repositoryPaths.push( path );
                    }
                }
            }
        }

        return {
            repositoryPaths: repositoryPaths,
        };
    }

    async repair ( shows : string[] = null ) {
        if ( !shows ) {
            shows = ( await this.find() ).map( show => show.id );
        }

        await super.repair( shows );

        await Promise.all( shows.map( async showId => {
            const show = await this.get( showId );

            const seasons = await this.relations.seasons.load( show );

            await this.database.tables.seasons.repair( seasons.map( season => season.id ) )

            const changes = {
                ...await this.repairEpisodesCount( show, seasons ),
                ...await this.repairRepositoryPaths( show, seasons ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( show, { seasons } ),
            };

            await this.updateIfChanged( show, changes );
        } ) );
    }
}

export class TvSeasonsMediaTable extends MediaTable<TvSeasonMediaRecord> {
    readonly tableName : string = 'media_tvseasons';

    readonly kind : MediaKind = MediaKind.TvSeason;

    baseline : Partial<TvSeasonMediaRecord> = {
        watchedEpisodesCount: 0,
        episodesCount: 0,
        transient: false
    };

    foreignMediaKeys : MediaTableForeignKeys = {
        tvShowId: MediaKind.TvShow
    }

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'number' },
        { name: 'tvShowId' },
        { name: 'playCount' },
        { name: 'lastPlayedAt' },
    ];

    declare relations : {
        collections: ManyToManyRelation<TvSeasonMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvSeasonMediaRecord, PersonRecord>,
        show: BelongsToOneRelation<TvSeasonMediaRecord, TvShowMediaRecord>,
        episodes: HasManyRelation<TvSeasonMediaRecord, TvEpisodeMediaRecord>,
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            show: new BelongsToOneRelation( 'tvShow', tables.shows, 'tvShowId', 'tvShowId' ),
            episodes: new HasManyRelation( 'episodes', tables.episodes, 'tvSeasonId' ).indexBy( 'tvSeasonId' ).orderBy( 'number' ),
        };
    }

    async repairEpisodesCount ( season : string | TvSeasonMediaRecord, episodes : TvEpisodeMediaRecord[] | null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        episodes = episodes ?? await this.relations.episodes.load( season );

        const episodesCount : number = itt( episodes ).keyBy( episode => episode.number ).size;

        const watchedEpisodesCount : number = itt( episodes ).filter( episode => episode.watched ).keyBy( episode => episode.number ).size;

        return {
            episodesCount,
            watchedEpisodesCount
        };
    }

    async repairTvShowArt ( season : string | TvSeasonMediaRecord, show : TvShowMediaRecord | null = null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        show = show ?? await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return {};
        }

        return {
            art: {
                ...season.art,
                tvshow: show.art
            }
        };
    }

    async repairRepositoryPaths ( season : string | TvSeasonMediaRecord, episode : TvEpisodeMediaRecord[] = null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        const episodes = await this.relations.episodes.load( season );

        const repositoryPaths : string[] = [];

        for ( let episode of episodes ) {
            if ( episode.repositoryPaths instanceof Array ) {
                for ( let path of episode.repositoryPaths ) {
                    if ( !repositoryPaths.includes( path ) ) {
                        repositoryPaths.push( path );
                    }
                }
            }
        }

        return {
            repositoryPaths: repositoryPaths,
        };
    }

    async repair ( seasons : string[] = null ) {
        if ( !seasons ) {
            seasons = ( await this.find() ).map( season => season.id );
        }

        await super.repair( seasons );

        await Promise.all( seasons.map( async seasonId => {
            const season = await this.get( seasonId );

            const episodes = await this.relations.episodes.load( season );

            await this.database.tables.episodes.repair( episodes.map( episode => episode.id ) )

            const changes = {
                ...await this.repairEpisodesCount( season, episodes ),
                ...await this.repairTvShowArt( season ),
                ...await this.repairRepositoryPaths( season, episodes ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( season, { episodes } ),
            };

            await this.updateIfChanged( season, changes );

            Object.assign( season, changes );
        } ) );
    }
}

export class TvEpisodesMediaTable extends MediaTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'media_tvepisodes';

    readonly kind : MediaKind = MediaKind.TvEpisode;

    dateFields = [ 'addedAt', 'airedAt', 'lastPlayedAt' ];

    baseline : Partial<TvEpisodeMediaRecord> = {
        watched: false,
        lastPlayedAt: null,
        playCount: 0,
        transient: false
    };

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'number' },
        { name: 'tvSeasonId' },
        { name: 'lastPlayedAt' },
        { name: 'playCount' },
        { name: 'airedAt' },
        { name: 'addedAt' }
    ];

    foreignMediaKeys : MediaTableForeignKeys = {
        tvSeasonId: MediaKind.TvSeason
    }

    declare relations : {
        season: BelongsToOneRelation<TvEpisodeMediaRecord, TvSeasonMediaRecord>,
        collections: ManyToManyRelation<TvEpisodeMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvEpisodeMediaRecord, PersonRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            season: new BelongsToOneRelation( 'tvSeason', tables.seasons, 'tvSeasonId' ),
        };
    }

    async repairTvShowArt ( episode : string | TvEpisodeMediaRecord ) : Promise<Partial<TvEpisodeMediaRecord>> {
        if ( typeof episode === 'string' ) {
            episode = await this.get( episode );
        }

        const season = await this.database.tables.seasons.get( episode.tvSeasonId );

        if ( !season ) {
            return episode;
        }

        const show = await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return {};
        }

        return {
            art: {
                ...episode.art,
                tvshow: show.art
            }
        };
    }

    async repair ( episodes : string[] = null ) {
        if ( !episodes ) {
            episodes = ( await this.find() ).map( episode => episode.id );
        }

        await super.repair( episodes );

        await Promise.all( episodes.map( async episodeId => {
            const episode = await this.get( episodeId );

            const changes = {
                ...await this.repairTvShowArt( episode ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( episode ),
            }

            await this.updateIfChanged( episode, changes );

            Object.assign( episode, changes );
        } ) );
    }
}

export class CustomMediaTable extends MediaTable<CustomMediaRecord> {
    readonly tableName : string = 'media_custom';

    readonly kind : MediaKind = MediaKind.Custom;

    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'title' },
        { name: 'lastPlayedAt' },
        { name: 'playCount' },
        { name: 'addedAt' }
    ];
}

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'createdAt' },
        { name: 'updatedAt' }
    ];

    declare relations: {
        items: ManyToManyPolyRelation<PlaylistRecord, MediaRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            items: new ManyToManyPolyRelation( 'items', map, 'references', null, 'kind', 'id' )
        };
    }
}

export class HistoryTable extends BaseTable<HistoryRecord> {
    readonly tableName : string = 'history';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'createdAt' },
        { name: 'reference', expression: [ r.row( 'reference' )( 'kind' ), r.row( 'reference' )( 'id' ) ] }
    ];

    declare relations: {
        record: BelongsToOnePolyRelation<HistoryRecord, MediaRecord, { record: MediaRecord }>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'reference.kind', 'reference.id' )
        };
    }
}

export class CollectionsTable extends BaseTable<CollectionRecord> {
    readonly tableName : string = 'collections';

    indexesSchema : IndexSchema[] = [
        { name: 'title' },
        { name: 'identifier' }
    ];

    declare relations: {
        records: ManyToManyPolyRelation<CollectionRecord, MediaRecord>;
        parent: BelongsToOneRelation<CollectionRecord, HistoryRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            records: new ManyToManyPolyRelation( 'records', map, tables.collectionsMedia, 'collectionId', 'mediaKind', 'mediaId' ),
            parent: new BelongsToOneRelation( 'parent', this, 'parentId' ),
        };
    }

    identifierFields: string[] = [ 'title' ];

    protected static buildTreeNode ( record : CollectionTreeRecord, collectionsDictionary : Map<string, CollectionTreeRecord[]> ) : CollectionTreeRecord {
        if ( record.children != null ) {
            return record;
        }

        record.children = collectionsDictionary.get( record.id ) || [];

        for ( let child of record.children ) {
            this.buildTreeNode( child, collectionsDictionary );
        }

        return record;
    }

    public static buildTree ( collections: CollectionRecord[] ) : CollectionTreeRecord[] {
        const collectionsDictionary = collect( collections, groupingBy( item => item.parentId ) );
        const collectionsSet = collect( collections, mapping( col => col.id, toSet() ) );

        return collections
            .filter( record => record.parentId == null || !collectionsSet.has( record.parentId ) )
            .map( record => CollectionsTable.buildTreeNode( record, collectionsDictionary ) );
    }

    public static findInTrees ( collections: CollectionTreeRecord[], predicate : ( col: CollectionTreeRecord ) => boolean ) : CollectionTreeRecord {
        let result : CollectionTreeRecord = null;

        for ( let node of collections ) {
            if ( predicate( node ) ) {
                return node;
            }

            if ( result = this.findInTrees( node.children, predicate ) ) {
                return result;
            }
        }
    }

    public static * iterateTrees ( collections: CollectionTreeRecord[], order : TreeIterationOrder = TreeIterationOrder.TopDown ) : IterableIterator<CollectionTreeRecord> {
        for ( let node of collections ) {
            if ( order == TreeIterationOrder.BottomUp && node.children.length > 0 ) {
                yield * this.iterateTrees( node.children );
            }

            yield node;

            if ( order == TreeIterationOrder.TopDown && node.children.length > 0 ) {
                yield * this.iterateTrees( node.children );
            }
        }
    }
}

export enum TreeIterationOrder {
    TopDown,
    BottomUp,
}

export class CollectionMediaTable extends BaseTable<CollectionMediaRecord> {
    readonly tableName : string = 'collection_media';

    dateFields = [ 'createdAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'collectionId' },
        { name: 'reference', expression: [ r.row( 'mediaKind' ), r.row( 'mediaId' ) ] }
    ];

    declare relations: {
        record: BelongsToOnePolyRelation<CollectionMediaRecord, MediaRecord, { record : MediaRecord }>;
        collection: BelongsToOneRelation<CollectionMediaRecord, CollectionRecord, { collection : CollectionRecord }>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'mediaKind', 'mediaId' ),
            collection: new BelongsToOneRelation( 'collection', tables.collections, 'collectionId', 'collectionId' )
        };
    }

    async repair ( records : string[] = null ) {
        if ( !records ) {
            records = ( await this.find() ).map( record => record.id );
        }

        await super.repair( records );

        await Promise.all( records.map( async recordId => {
            const record = await this.get( recordId );

            if ( !record ) return;

            const media = await this.relations.record.load( record );

            if ( !media ) {
                await this.delete( recordId );
            } else {
                await this.deleteMany(
                    query => query( 'mediaKind' ).eq( media.kind )
                        .and( query( 'mediaId' ).eq( media.id ) )
                        .and( query( 'collectionId' ).eq( record.collectionId ) )
                        .and( query( 'id' ).eq( record.id ).not() )
                );
            }
        } ) );
    }
}

export class UserRanksTable extends BaseTable<UserRankRecord> {
    readonly tableName : string = 'user_ranks';

    indexesSchema : IndexSchema[] = [
        { name: 'list' },
        { name: 'position' },
        { name: 'reference', expression: [ r.row( 'reference' )( 'kind' ), r.row( 'reference' )( 'id' ) ] }
    ];

    declare relations: {
        record: BelongsToOnePolyRelation<UserRankRecord, MediaRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'reference.kind', 'reference.id' )
        };
    }
}

export interface UserRankRecord  {
    id?: string;
    list: string;
    reference: {kind: MediaKind, id: string};
    position: number;
}

export class SubtitlesTable extends BaseTable<SubtitleMediaRecord> {
    readonly tableName : string = 'subtitles';

    indexesSchema : IndexSchema[] = [
        { name: 'reference', expression: [ r.row( 'reference' )( 'kind' ), r.row( 'reference' )( 'id' ) ] }
    ];

    declare relations: {
        record: BelongsToOnePolyRelation<SubtitleMediaRecord, MediaRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'reference.kind', 'reference.id' )
        };
    }
}

export class PersistentQueueTable<R extends JobRecord> extends BaseTable<R> {
    tableName : string = 'job_queue';
}

export class PeopleTable extends BaseTable<PersonRecord> {
    tableName : string = 'people';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'name' },
        { name: 'identifier' }
    ];

    declare relations: {
        credits: ManyToManyPolyRelation<PersonRecord, MediaRecord>;
    };

    identifierFields: string[] = [ 'name' ];

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            credits: new ManyToManyPolyRelation( 'credits', map, tables.mediaCast, 'personId', 'mediaKind', 'mediaId' ).savePivot( 'role' ),
        };
    }
}

export class MediaCastTable extends BaseTable<MediaCastRecord> {
    tableName : string = 'media_cast';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' },
        { name: 'personId' },
        { name: 'reference', expression: [ r.row( 'mediaKind' ), r.row( 'mediaId' ) ] }
    ];

    declare relations: {
        record: BelongsToOnePolyRelation<MediaCastRecord, MediaRecord>;
        person : BelongsToOneRelation<MediaCastRecord, PersonRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );

        return {
            record: new BelongsToOnePolyRelation( 'record', map, 'kind', 'id' ),
            person: new BelongsToOneRelation( 'person', tables.people, 'personId', 'personId' )
        };
    }
}

export class StorageTable extends BaseTable<StorageRecord> {
    tableName : string = 'storage';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [
        { name: 'key' },
        { name: 'tags', options: { multi: true } }
    ];
}

export class DatabaseDaemon {
    server : UnicastServer;

    process : ChildProcess;

    protected futureStart : Future<void>;

    protected futureClose : Future<void>;

    constructor ( server : UnicastServer ) {
        this.server = server;

        server.onClose.subscribe( this.close.bind( this ) );
    }

    async online () : Promise<boolean> {
        try {
            const conn = await r.connect( this.server.config.get<r.ConnectionOptions>( 'database' ) );

            await conn.close();

            return true;
        } catch ( error ) {
            return false;
        }
    }

    async start () {
        if ( this.futureStart != null ) {
            return this.futureStart.promise;
        }

        this.futureStart = new Future<void>();
        this.futureClose = new Future<void>();

        this.server.logger.info( 'Database', 'Starting engine' );

        if ( await this.online() ) {
            this.server.logger.info( 'Database', 'Engine already running. Piggybacking.' );

            return this.futureStart.resolve();
        }

        const config = this.server.config.get( 'database.autostart' );

        this.process = spawn( config.command, config.args, {
            cwd: config.cwd
        } );

        this.process.stdout.on( 'data', d => {
            const lines = d.toString()
                .split( '\n' )
                .map( line => line.trim() )
                .filter( line => line != '' );

            for ( let line of lines ) {
                this.server.logger.info( 'Database', line );

                if ( line.startsWith( 'Server ready,' ) ) {
                    setTimeout( () => this.futureStart.resolve(), 5000 );
                }
            }
        } );

        this.process.on( 'exit', () => {
            this.futureClose.resolve();
        } )

        this.process.on( 'close', () => {
            this.futureClose.resolve();
        } );

        return this.futureStart.promise;
    }

    async close () {
        if ( !this.futureClose ) {
            return;
        }

        await this.start();

        await this.server.database.connections.close();

        if ( this.process ) {
            this.process.kill();
        } else {
            this.futureClose.resolve();
        }

        const promise = await this.futureClose.promise;

        this.process = null;
        this.futureClose = null;
        this.futureStart = null;

        return promise;
    }
}

export interface PlaylistRecord {
    id ?: string;
    references : { kind : MediaKind, id : string }[];
    device : string;
    createdAt : Date;
    updatedAt : Date;
}

export interface HistoryRecord {
    id ?: string;
    reference : { kind : MediaKind, id : string };
    playlist ?: string;
    playlistPosition ?: number;
    receiver : string;
    position : number;
    positionHistory : { start: number, end: number }[];
    transcoding ?: any;
    watched: boolean;
    createdAt : Date;
    updatedAt : Date;
}

export interface CollectionRecord {
    id ?: string;
    parentId ?: string;
    title : string;
    color : string;
    kinds : string[];
    primary : boolean;
}

export interface CollectionTreeRecord extends CollectionRecord {
    children ?: CollectionTreeRecord[];
}

export interface CollectionMediaRecord {
    id ?: string;
    collectionId : string;
    mediaKind : MediaKind;
    mediaId : string;
    createdAt : Date;
}

export interface JobRecord<P = any> {
    id ?: string;
    action : string;
    payload : P;
    priority : number;

    pastAttempts : number;
    maxAttempts : number;
    nextAttempt : Date;

    createdAt : Date;
    updatedAt : Date;
    attemptedAt : Date;
}

export interface StorageRecord<V = any> {
    id ?: string;
    key : string;
    tags : string[];
    value : V;
    createdAt : Date;
    updatedAt : Date;
}

export interface SubtitleMediaRecord extends IDatabaseLocalSubtitle { }

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

    findStream<T extends R> ( query ?: ( query : r.Sequence ) => r.Sequence ) {
        return this.applyStream( this.table.findStream<T>( query ) );
    }
}
