import * as r from 'rethinkdb';
import { MovieMediaRecord, TvShowMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, CustomMediaRecord, MediaKind, MediaRecord } from "../MediaRecord";
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
import { toArray } from 'data-async-iterators';
import { collect, groupingBy, first } from 'data-collectors';

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

    relations : any = {};

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
        if ( keys.length === 0 ) {
            return [];
        }
        
        const connection = await this.pool.acquire();

        try {
            let table = 
            opts.index ? 
                this.query().getAll( ( r as any ).args( keys ), { index: opts.index } ) :
                this.query().getAll( ( r as any ).args( keys ) );
    
            if ( opts.query ) {
                table = opts.query( table );
            }

            const cursor = await table.run( connection );
            
            const items = await cursor.toArray();
    
            await cursor.close();
    
            return items;
        } finally {
            await this.pool.release( connection );
        }
    }

    async find<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T[]> {
        return toArray( this.findStream<T>( query ) );
    }

    async * findStream<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : AsyncIterableIterator<T> {
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

    async findOne<T = R> ( query ?: ( query : r.Sequence ) => r.Sequence ) : Promise<T> {
        const results = await this.find<T>( subQuery => query ? query( subQuery ).limit( 1 ) : subQuery.limit( 1 ) );

        return results[ 0 ];
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

    async updateIfChanged ( baseRecord : object, changes : object ) : Promise<R> {
        if ( Object.keys( changes ).some( key => !equals( baseRecord[ key ], changes[ key ] ) ) ) {
            // @DEBUG
            // const changed = Object.keys( changes ).filter( key => !equals( baseRecord[ key ], changes[ key ] ) );

            // console.log( changed.map( key => `${key}(${typeof baseRecord[key]} ${baseRecord[key]}, ${ typeof changes[key] } ${changes[key]})` ) );
            
            return this.update( baseRecord[ "id" ], changes );
        }

        return baseRecord as R;
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

    async repair ( ids : string[] = null ) { }
}

export interface MediaTableForeignKeys {
    [ kind : string ]: MediaKind;
}

export abstract class MediaTable<R extends MediaRecord> extends BaseTable<R> {
    baseline : Partial<R> = {};

    foreignMediaKeys : MediaTableForeignKeys = {};

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

    relations : {
        collections: ManyToManyRelation<MovieMediaRecord, CollectionRecord>
    };
    
    installRelations ( tables : DatabaseTables ) {
        return {
            collections: new ManyToManyRelation( 'collections', tables.collectionsMedia, tables.collections, 'mediaId', 'collectionId' ).poly( 'mediaKind', 'movie' )
        };
    }

    baseline : Partial<MovieMediaRecord> = {
        watched: false,
        lastPlayed: null,
        playCount: 0,
        transient: false
    }
}

export class TvShowsMediaTable extends MediaTable<TvShowMediaRecord> {
    readonly tableName : string = 'media_tvshows';

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
        seasons: HasManyRelation<TvShowMediaRecord, TvSeasonMediaRecord>
    };
    
    installRelations ( tables : DatabaseTables ) {
        return {
            collections: new ManyToManyRelation( 'collections', tables.collectionsMedia, tables.collections, 'mediaId', 'collectionId' ).poly( 'mediaKind', 'show' ),
            seasons: new HasManyRelation( 'seasons', tables.seasons, 'tvShowId' ).indexBy( 'tvShowId' ).orderBy( 'number' )
        };
    }

    async updateEpisodesCount ( show : string | TvShowMediaRecord ) : Promise<TvShowMediaRecord> {
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

            await this.updateEpisodesCount( show );
        } ) );
    }
}

export class TvSeasonsMediaTable extends MediaTable<TvSeasonMediaRecord> {
    readonly tableName : string = 'media_tvseasons';

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
        show: BelongsToOneRelation<TvSeasonMediaRecord, TvShowMediaRecord>,
        episodes: HasManyRelation<TvSeasonMediaRecord, TvEpisodeMediaRecord>
    };
    
    installRelations ( tables : DatabaseTables ) {
        return {
            show: new BelongsToOneRelation( 'tvShow', tables.shows, 'tvShowId', 'tvShowId' ),
            episodes: new HasManyRelation( 'episodes', tables.episodes, 'tvSeasonId' ).indexBy( 'tvSeasonId' ).orderBy( 'number' )
        };
    }

    async updateEpisodesCount ( season : string | TvSeasonMediaRecord ) : Promise<TvSeasonMediaRecord> {
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

    async repair ( seasons : string[] = null ) {
        if ( !seasons ) {
            seasons = ( await this.find() ).map( season => season.id );
        }

        await super.repair( seasons );

        await Promise.all( seasons.map( async seasonId => {
            const season = await this.get( seasonId );

            const episodes = await this.relations.episodes.load( season );

            await this.database.tables.episodes.repair( episodes.map( episode => episode.id ) )

            await this.updateEpisodesCount( season );
        } ) );
    }
}

export class TvEpisodesMediaTable extends MediaTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'media_tvepisodes';
    
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
        { name: 'addedAt' }
    ];

    foreignMediaKeys : MediaTableForeignKeys = {
        tvSeasonId: MediaKind.TvSeason
    }
    
    relations : {
        season: BelongsToOneRelation<TvEpisodeMediaRecord, TvSeasonMediaRecord>
    };
    
    installRelations ( tables : DatabaseTables ) {
        return {
            season: new BelongsToOneRelation( 'tvSeason', tables.seasons, 'tvSeasonId' ),
        };
    }
}

export class CustomMediaTable extends MediaTable<CustomMediaRecord> {
    readonly tableName : string = 'media_custom';

    indexesSchema : IndexSchema[] = [
        { name: 'internalId' }
    ];
}

export class PlaylistsTable extends BaseTable<PlaylistRecord> {
    readonly tableName : string = 'playlists';

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

    indexesSchema : IndexSchema[] = [ 
        { name: 'createdAt' }
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

        this.server.diagnostics.info( 'Database', 'Starting engine' );

        if ( await this.online() ) {
            this.server.diagnostics.info( 'Database', 'Engine already running. Piggybacking.' );

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