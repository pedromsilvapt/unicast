import * as r from 'rethinkdb';
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
import { collect, groupingBy, first } from 'data-collectors';
import { ComposedTask } from '../BackgroundTask';

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

    onInstall : Hook<void>;

    constructor ( server : UnicastServer ) {
        this.onInstall = server.hooks.create<void>( 'database/install' );

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

                await this.onInstall.notify();

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

        return task;
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

    people : PeopleTable;

    mediaCast : MediaCastTable;

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

        this.people = new PeopleTable( pool );

        this.mediaCast = new MediaCastTable( pool );

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

        await this.people.install();

        await this.mediaCast.install();

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

    dateFields : string[] = [];

    relations : any = {};

    onCreate : Hook<R> = new Hook( 'onCreate' );

    onUpdate : Hook<R> = new Hook( 'onUpdate' );

    onDelete : Hook<R> = new Hook( 'onDelete' );

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

            this.relations = this.installRelations( this.database.tables );
        } finally {
            await this.pool.release( conn );
        }
    }

    installRelations ( tables : DatabaseTables ) {
        return {};
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

    async create ( record : R, options : Partial<r.OperationOptions> = {} ) : Promise<R> {
        const connection = await this.pool.acquire();

        try {
            for ( let field of Object.keys( record ) ) {
                if ( record[ field ] === void 0 ) {
                    record[ field ] = null;
                }
            }
    
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

export interface MediaTableForeignKeys {
    [ kind : string ]: MediaKind;
}

export abstract class MediaTable<R extends MediaRecord> extends BaseTable<R> {
    protected readonly abstract kind : MediaKind;

    baseline : Partial<R> = {};

    foreignMediaKeys : MediaTableForeignKeys = {};

    relations : {
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
        { name: 'parentalRating' },
        { name: 'year' },
        { name: 'lastPlayed' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
    ];

    dateFields = [ 'addedAt', 'lastPlayed' ];

    relations : {
        collections: ManyToManyRelation<MovieMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<MovieMediaRecord, PersonRecord>
    };
    
    baseline : Partial<MovieMediaRecord> = {
        watched: false,
        lastPlayed: null,
        playCount: 0,
        transient: false
    }
}

export class TvShowsMediaTable extends MediaTable<TvShowMediaRecord> {
    readonly tableName : string = 'media_tvshows';

    readonly kind : MediaKind = MediaKind.TvShow;

    dateFields = [ 'addedAt', 'lastPlayed' ];

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
        { name: 'lastPlayed' },
        { name: 'addedAt' },
        { name: 'genres', options: { multi: true } },
    ];
    
    relations : {
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

    async repairEpisodesCount ( show : string | TvShowMediaRecord ) : Promise<TvShowMediaRecord> {
        if ( typeof show === 'string' ) {
            show = await this.get( show );
        }

        const seasons = await this.relations.seasons.load( show );

        const seasonsCount = seasons.length;

        const episodesCount = itt( seasons ).map( season => season.episodesCount ).sum();

        const watchedEpisodesCount = itt( seasons ).map( season => season.watchedEpisodesCount ).sum();

        return this.updateIfChanged( show, {
            watched: episodesCount == watchedEpisodesCount,
            seasonsCount, episodesCount, watchedEpisodesCount
        } );
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

            await this.repairEpisodesCount( show );
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
        { name: 'tvShowId' }
    ];
    
    relations : {
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

    async repairEpisodesCount ( season : string | TvSeasonMediaRecord ) : Promise<TvSeasonMediaRecord> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        // const episodes = await this.database.tables.episodes.find( query => query.filter( { tvSeasonId: id } ) );
        const episodes = await this.relations.episodes.load( season );

        const episodesCount : number = itt( episodes ).keyBy( episode => episode.number ).size;

        const watchedEpisodesCount : number = itt( episodes ).filter( episode => episode.watched ).keyBy( episode => episode.number ).size;

        return this.updateIfChanged( season, {
            episodesCount,
            watchedEpisodesCount
        } );
    }

    async repairTvShowArt ( season : string | TvSeasonMediaRecord ) : Promise<TvSeasonMediaRecord> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        const show = await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return season;
        }

        return this.updateIfChanged( season, {
            art: {
                ...season.art,
                tvshow: show.art
            }
        } );
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

            await this.repairEpisodesCount( season );

            await this.repairTvShowArt( season );
        } ) );
    }
}

export class TvEpisodesMediaTable extends MediaTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'media_tvepisodes';

    readonly kind : MediaKind = MediaKind.TvEpisode;
    
    dateFields = [ 'addedAt', 'airedAt', 'lastPlayed' ];

    baseline : Partial<TvEpisodeMediaRecord> = {
        watched: false,
        lastPlayed: null,
        playCount: 0,
        transient: false
    };

    indexesSchema : IndexSchema[] = [ 
        { name: 'internalId' },
        { name: 'number' },
        { name: 'tvSeasonId' },
        { name: 'lastPlayed' },
        { name: 'airedAt' },
        { name: 'addedAt' }
    ];

    foreignMediaKeys : MediaTableForeignKeys = {
        tvSeasonId: MediaKind.TvSeason
    }
    
    relations : {
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

    async repairTvShowArt ( episode : string | TvEpisodeMediaRecord ) : Promise<TvEpisodeMediaRecord> {
        if ( typeof episode === 'string' ) {
            episode = await this.get( episode );
        }

        const season = await this.database.tables.seasons.get( episode.tvSeasonId );

        if ( !season ) {
            return episode;
        }

        const show = await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return episode;
        }

        return this.updateIfChanged( episode, {
            art: {
                ...episode.art,
                tvshow: show.art
            }
        } );
    }

    async repair ( episodes : string[] = null ) {
        if ( !episodes ) {
            episodes = ( await this.find() ).map( episode => episode.id );
        }

        await super.repair( episodes );

        await Promise.all( episodes.map( async episodeId => {
            const episode = await this.get( episodeId );

            await this.repairTvShowArt( episode );
        } ) );
    }
}

export class CustomMediaTable extends MediaTable<CustomMediaRecord> {
    readonly tableName : string = 'media_custom';

    readonly kind : MediaKind = MediaKind.Custom;

    dateFields = [ 'addedAt', 'lastPlayed' ];

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' }
    ];
}

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';

    dateFields = [ 'createdAt', 'updatedAt' ];

    indexesSchema : IndexSchema[] = [ 
        { name: 'createdAt' },
        { name: 'updatedAt' }
    ];

    relations: {
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
        { name: 'reference', expression: [ r.row( 'reference' )( 'mediaKind' ), r.row( 'reference' )( 'mediaId' ) ] }
    ];
    
    relations: {
        record: BelongsToOnePolyRelation<HistoryRecord, MediaRecord>;
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
        { name: 'title' }
    ];
    
    relations: {
        records: ManyToManyPolyRelation<CollectionRecord, MediaRecord>;
    }

    installRelations ( tables : DatabaseTables ) {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( tables );
    
        return {
            records: new ManyToManyPolyRelation( 'records', map, tables.collectionsMedia, 'collectionId', 'mediaKind', 'mediaId' )
        };
    }
}

export class CollectionMediaTable extends BaseTable<CollectionMediaRecord> {
    readonly tableName : string = 'collection_media';

    dateFields = [ 'createdAt' ];

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

    relations: {
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
        { name: 'name' }
    ];

    relations: {
        credits: ManyToManyPolyRelation<PersonRecord, MediaRecord>;
    };

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
    
    relations: {
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

export function createMediaRecordPolyMap ( tables : DatabaseTables ) : PolyRelationMap<MediaRecord> {
    return {
        'movie': tables.movies,
        'show': tables.shows,
        'season': tables.seasons,
        'episode': tables.episodes,
        'custom': tables.custom
    };
}