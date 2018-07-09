import * as r from 'rethinkdb';
import { MovieMediaRecord, TvShowMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, CustomMediaRecord, MediaKind, MediaRecord } from "./MediaRecord";
import { Semaphore, StateSemaphore } from 'data-semaphore';
import { Config } from "./Config";
import { IDatabaseLocalSubtitle } from './Subtitles/SubtitlesRepository';
import * as itt from 'itt';
import { UnicastServer } from './UnicastServer';
import { ChildProcess, spawn } from 'child_process';
import { Future } from '@pedromsilva/data-future';

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
    config : Config;

    connections : ConnectionPool;

    tables : DatabaseTables;

    daemon : DatabaseDaemon;

    protected installedFuture : Future<void> = new Future();

    installed : Promise<void> = this.installedFuture.promise;

    constructor ( server : UnicastServer ) {
        this.config = server.config;

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

                await ( r.db( databaseName ) as any ).wait().run( conn );
            } finally {
                await this.connections.release( conn );
            }

            this.installedFuture.resolve();
        } catch ( err ) {
            this.installedFuture.reject( err );
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

    subtitles : SubtitlesTable;

    jobsQueue : PersistentQueueTable<JobRecord>;

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

        this.subtitles = new SubtitlesTable( pool );

        this.jobsQueue = new PersistentQueueTable( pool );
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

        await this.subtitles.install();

        await this.jobsQueue.install();
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

export abstract class BaseTable<R extends { id ?: string }> {
    abstract readonly tableName : string;

    pool : ConnectionPool;

    indexesSchema : IndexSchema[] = [];

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
        } finally {
            await this.pool.release( conn );
        }
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

    async findAll ( keys : any[], opts : { index ?: string } = {} ) : Promise<R[]> {
        if ( keys.length === 0 ) {
            return [];
        }
        
        const connection = await this.pool.acquire();

        try {
            const table = 
            // opts.index ? 
            //     this.query().getAll( ...keys, opts ) :
                this.query().getAll( ...keys );
    
            const cursor = await table.run( connection );
            
            const items = await cursor.toArray();
    
            await cursor.close();
    
            return items;
        } finally {
            await this.pool.release( connection );
        }
    }

    async find<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T[]> {
        const connection = await this.pool.acquire();

        try {
            let table = this.query();
            
            let sequence : r.Sequence = table;
    
            if ( query ) {
                sequence = query( table );
            }
    
            const cursor = await sequence.run( connection );
    
            const items = await cursor.toArray();
    
            await cursor.close();
                
            return items;
        } finally {
            await this.pool.release( connection );
        }
    }

    async create ( record : R ) : Promise<R> {
        const connection = await this.pool.acquire();

        try {
            for ( let field of Object.keys( record ) ) {
                if ( record[ field ] === void 0 ) {
                    record[ field ] = null;
                }
            }
    
            const res = await this.query().insert( record ).run( connection );
    
            record.id = res.generated_keys[ 0 ];
            
            return record;
        } finally {
            this.pool.release( connection );
        }
    }

    async update ( id : string, record : any ) : Promise<R> {
        const connection = await this.pool.acquire();

        try {
            await this.query().get( id ).update( record ).run( connection );
    
            return record;
        } finally {
            this.pool.release( connection );
        }
    }

    async updateMany ( predicate : RethinkPredicate, update : any, limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();

        try {
            let query = this.query().filter( predicate );
    
            if ( limit && limit < Infinity ) {
                query = query.limit( limit );
            }
    
            const operation = await query.update( update ).run( connection );
    
            return operation.replaced;
        } finally {
            this.pool.release( connection );
        }
    }

    async delete ( id : string ) : Promise<boolean> {
        const connection = await this.pool.acquire();

        try {
            const operation = await this.query().get( id ).delete().run( connection );
    
            return operation.deleted > 0;
        } finally {
            this.pool.release( connection );
        }
    }

    async deleteMany ( predicate : RethinkPredicate, limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();
        
        try {
            let query = this.query().filter( predicate );
    
            if ( limit && limit < Infinity ) {
                query = query.limit( limit );
            }
            
            const operation = await query.delete().run( connection );
    
            return operation.deleted;
        } finally {
            this.pool.release( connection );
        }
    }

    async deleteAll ( limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();

        try {
            const res = await this.query().delete().run( connection );
    
            return res.deleted;
        } finally {
            this.pool.release( connection );
        }
    }
}

export abstract class MediaTable<R extends MediaRecord> extends BaseTable<R> {
    
}

export class MoviesMediaTable extends MediaTable<MovieMediaRecord> {
    readonly tableName : string = 'media_movies';

    indexesSchema : IndexSchema[] = [ 
        { name: 'title' },
        { name: 'rating' },
        { name: 'parentalRating' },
        { name: 'year' },
        { name: 'lastPlayed' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
    ];
}

export class TvShowsMediaTable extends MediaTable<TvShowMediaRecord> {
    readonly tableName : string = 'media_tvshows';

    indexesSchema : IndexSchema[] = [ 
        { name: 'title' },
        { name: 'seasonsCount' },
        { name: 'rating' },
        { name: 'parentalRating' },
        { name: 'year' },
        { name: 'lastPlayed' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
    ];

    async updateEpisodesCount ( id : string ) : Promise<TvShowMediaRecord> {
        const seasons = await this.database.tables.seasons.find( query => query.filter( {
            tvShowId: id
        } ) );

        const show : TvShowMediaRecord = null;

        const seasonsCount = seasons.length;

        const episodesCount = itt( seasons ).map( season => season.episodesCount ).sum();

        const watchedEpisodesCount = itt( seasons ).map( season => season.watchedEpisodesCount ).sum();

        return this.update( id, {
            watched: episodesCount == watchedEpisodesCount,
            seasonsCount, episodesCount, watchedEpisodesCount
        } );
    }
}

export class TvSeasonsMediaTable extends MediaTable<TvSeasonMediaRecord> {
    readonly tableName : string = 'media_tvseasons';

    indexesSchema : IndexSchema[] = [ 
        { name: 'number' },
        { name: 'tvShowId' }
    ];

    async updateEpisodesCount ( id : string ) : Promise<TvSeasonMediaRecord> {
        const season = await this.database.tables.seasons.get( id );

        const episodes = await this.database.tables.episodes.find( query => query.filter( { tvSeasonId: id } ) );

        const episodesCount : number = itt( episodes ).keyBy( episode => episode.number ).size;

        const watchedEpisodesCount : number = itt( episodes ).filter( episode => episode.watched ).keyBy( episode => episode.number ).size;

        return this.update( id, {
            episodesCount,
            watchedEpisodesCount
        } );
    }
}

export class TvEpisodesMediaTable extends MediaTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'media_tvepisodes';
    
    indexesSchema : IndexSchema[] = [ 
        { name: 'number' },
        { name: 'tvSeasonId' },
        { name: 'lastPlayed' },
        { name: 'addedAt' }
    ];
}

export class CustomMediaTable extends MediaTable<CustomMediaRecord> {
    readonly tableName : string = 'media_custom';
}

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';

    indexesSchema : IndexSchema[] = [ 
        { name: 'createdAt' },
        { name: 'updatedAt' }
    ];
}

export class HistoryTable extends BaseTable<HistoryRecord> {
    readonly tableName : string = 'history';

    indexesSchema : IndexSchema[] = [ 
        { name: 'createdAt' }
    ];
}

export class CollectionsTable extends BaseTable<CollectionRecord> {
    readonly tableName : string = 'collections';

    indexesSchema : IndexSchema[] = [ 
        { name: 'title' }
    ];
}

export class CollectionMediaTable extends BaseTable<CollectionMediaRecord> {
    readonly tableName : string = 'collection_media';

    indexesSchema : IndexSchema[] = [ 
        { name: 'collectionId' },
        { name: 'reference', expression: [ r.row( 'mediaKind' ), r.row( 'mediaId' ) ] }
    ];
}

export class SubtitlesTable extends BaseTable<SubtitleMediaRecord> {
    readonly tableName : string = 'subtitles';

    indexesSchema : IndexSchema[] = [ 
        { name: 'reference', expression: [ r.row( 'reference' )( 'kind' ), r.row( 'reference' )( 'id' ) ] }
    ];
}

export class PersistentQueueTable<R extends JobRecord> extends BaseTable<R> {
    tableName : string = 'job_queue';
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

    start () {
        if ( this.futureStart != null ) {
            return this.futureStart.promise;
        }

        this.futureStart = new Future<void>();
        this.futureClose = new Future<void>();

        this.server.diagnostics.info( 'Database', 'Starting engine' );

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
                this.server.diagnostics.info( 'Database', line );
                    
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
   
        this.process.kill();

        const promise = await this.futureClose.promise;

        this.process = null;
        this.futureClose = null;
        this.futureStart = null;
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
    watched: boolean;
    createdAt : Date;
    updatedAt : Date;
}

export interface CollectionRecord {
    id ?: string;
    title : string;
    color : string;
    kinds : string[];
    primary : boolean;
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

export interface SubtitleMediaRecord extends IDatabaseLocalSubtitle { }