import * as r from 'rethinkdb';
import { MovieMediaRecord, TvShowMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, CustomMediaRecord, MediaKind } from "./MediaRecord";
import { Semaphore } from 'await-semaphore';
import { Config } from "./Config";

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

    constructor ( config : Config ) {
        this.config = config;

        this.connections = new ConnectionPool( this );

        this.tables = new DatabaseTables( this.connections );
    }

    connect () : Promise<r.Connection> {
        /*{
            db: 'unicast',
            host: '127.0.0.1',
            port: 28015
        }*/
        return r.connect( this.config.get<r.ConnectionOptions>( 'database' ) );
    }

    async install () {
        const databaseName : string = this.config.get<string>( 'database.db' );

        const conn = await this.connections.acquire();

        const databases = await r.dbList().run( conn );

        if ( !databases.includes( databaseName ) ) {
            await r.dbCreate( databaseName ).run( conn );
        }

        await this.connections.release( conn );

        await this.tables.install();
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

    constructor ( db : Database ) {
        this.database = db;

        this.semaphore = new Semaphore( this.maxConnections );
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
        const release = await this.semaphore.acquire();

        let conn : ConnectionResource;
        
        while ( this.freeConnections.length && !conn ) {
            conn = this.freeConnections.pop();

            if ( !conn.connection.open ) {
                this.destroyConnection( conn );   
            }
        }

        conn = conn || await this.createConnection();;

        if ( conn.timeout ) {
            clearTimeout( conn.timeout );
        }

        conn.usageCount += 1;

        conn.inUse = true;

        conn.release = release;

        this.usedConnections.set( conn.connection, conn );

        return conn.connection;
    }
    
    async release ( connection : r.Connection ) : Promise<void> {
        if ( this.usedConnections.has( connection ) ) {
            const resource = this.usedConnections.get( connection );

            this.usedConnections.delete( connection );

            resource.inUse = false;

            if ( resource.usageCount <= this.maxConnectionUsage && this.maxConnectionWait > 0 ) {
                resource.timeout = setTimeout( () => this.destroyConnection( resource ), this.maxConnectionWait );

                this.freeConnections.push( resource );
            } else {
                this.destroyConnection( resource );
            }

            resource.release();
        }
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

    constructor ( pool : ConnectionPool ) {
        this.pool = pool;
    }

    query () : r.Table {
        return r.table( this.tableName );
    }

    async install () {
        const conn = await this.pool.acquire();

        const tables : string[] = await r.tableList().run( conn );

        if ( !tables.includes( this.tableName ) ) {
            await r.tableCreate( this.tableName ).run( conn );
        }

        await this.pool.release( conn );

        await this.installIndexes();
    }

    async installIndexes () {
        const conn = await this.pool.acquire();

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

        await this.query().indexWait().run( conn );

        await this.pool.release( conn );
    }

    async get ( id : string ) : Promise<R> {
        const connection = await this.pool.acquire();

        const item = await this.query().get( id ).run( connection ) as any as Promise<R>;

        await this.pool.release( connection );

        return item;
    }

    async has ( id : string ) : Promise<boolean> {
        return ( await this.get( id ) ) != null;
    }

    async findAll ( keys : any[], opts : { index ?: string } = {} ) : Promise<R[]> {
        if ( keys.length === 0 ) {
            return [];
        }
        
        const connection = await this.pool.acquire();

        const table = 
        // opts.index ? 
        //     this.query().getAll( ...keys, opts ) :
            this.query().getAll( ...keys );

        const cursor = await table.run( connection );
        
        const items = await cursor.toArray();

        await cursor.close();

        await this.pool.release( connection );
        
        return items;
    }

    async find<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T[]> {
        const connection = await this.pool.acquire();

        let table = this.query();
        
        let sequence : r.Sequence = table;

        if ( query ) {
            sequence = query( table );
        }

        const cursor = await sequence.run( connection );

        const items = await cursor.toArray();

        await cursor.close();

        await this.pool.release( connection );
        
        return items;
    }

    async create ( record : R ) : Promise<R> {
        const connection = await this.pool.acquire();

        for ( let field of Object.keys( record ) ) {
            if ( record[ field ] === void 0 ) {
                record[ field ] = null;
            }
        }

        const res = await this.query().insert( record ).run( connection );

        this.pool.release( connection );

        record.id = res.generated_keys[ 0 ];

        return record;
    }

    async update ( id : string, record : any ) : Promise<R> {
        const connection = await this.pool.acquire();

        const res = await this.query().get( id ).update( record ).run( connection );

        this.pool.release( connection );

        return record;
    }

    async updateMany ( predicate : r.ExpressionFunction<boolean>, update : any, limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();
        
        let query = this.query().filter( predicate );

        if ( limit && limit < Infinity ) {
            query = query.limit( limit );
        }

        const operation = await query.update( update ).run( connection );

        this.pool.release( connection );

        return operation.replaced;
    }

    async delete ( id : string ) : Promise<boolean> {
        const connection = await this.pool.acquire();
        
        const operation = await this.query().get( id ).delete().run( connection );

        this.pool.release( connection );

        return operation.deleted > 0;
    }

    async deleteMany ( predicate : r.ExpressionFunction<boolean>, limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();
        
        let query = this.query().filter( predicate );

        if ( limit && limit < Infinity ) {
            query = query.limit( limit );
        }
        
        const operation = await query.delete().run( connection );

        this.pool.release( connection );

        return operation.deleted;
    }

    async deleteAll ( limit : number = Infinity ) : Promise<number> {
        const connection = await this.pool.acquire();
        
        const res = await this.query().delete().run( connection );

        this.pool.release( connection );

        return res.deleted;
    }
}

export class MoviesMediaTable extends BaseTable<MovieMediaRecord> {
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

export class TvShowsMediaTable extends BaseTable<TvShowMediaRecord> {
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
}

export class TvSeasonsMediaTable extends BaseTable<TvSeasonMediaRecord> {
    readonly tableName : string = 'media_tvseasons';

    indexesSchema : IndexSchema[] = [ 
        { name: 'number' },
        { name: 'tvShowId' }
    ];
}

export class TvEpisodesMediaTable extends BaseTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'media_tvepisodes';
    
    indexesSchema : IndexSchema[] = [ 
        { name: 'number' },
        { name: 'tvSeasonId' },
        { name: 'lastPlayed' },
        { name: 'addedAt' }
    ];
}

export class CustomMediaTable extends BaseTable<CustomMediaRecord> {
    readonly tableName : string = 'media_custom';
}

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';
}

export class HistoryTable extends BaseTable<HistoryRecord> {
    readonly tableName : string = 'history';
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
        { name: 'reference', expression: [ r.row( 'reference' )( 'kind' ), r.row( 'reference' )( 'id' ) ] }
    ];
}

export interface PlaylistRecord {
    id ?: string;
    references : { kind : MediaKind, id : string }[];
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
    createdAt : Date;
    updatedAt : Date;
}

export interface CollectionRecord {
    id ?: string;
    title : string;
    color : string;
    kinds : string[];
}

export interface CollectionMediaRecord {
    id : string;
    collectionId : string;
    mediaKind : string;
    mediaId : string;
    createdAt : Date;
}