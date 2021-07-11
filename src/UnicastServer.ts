import { ProvidersManager, MediaSourceLike } from "./MediaProviders/ProvidersManager";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, MediaRecord, CustomMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord, MovieMediaRecord, PlayableMediaRecord, PersonRecord, isTvEpisodeRecord, isTvSeasonRecord, isMovieRecord, isTvShowRecord, isCustomRecord } from "./MediaRecord";
import { Database, BaseTable, CollectionRecord, MediaTable, UserRankRecord, UserRanksTable } from "./Database/Database";
import { Config, TypeSchema } from "./Config";
import * as restify from 'restify';
import { ReceiversManager } from "./Receivers/ReceiversManager";
import { routes } from 'unicast-interface';
import * as internalIp from 'internal-ip';
import * as corsMiddleware from 'restify-cors-middleware';
import { ApiController } from "./Controllers/ApiControllers/ApiController";
import * as sortBy from 'sort-by';
import { BackgroundTasksManager } from "./BackgroundTask";
import { Storage } from "./Storage";
import { TranscodingManager } from "./Transcoding/TranscodingManager";
import * as fs from 'mz/fs';
import { EventEmitter } from "events";
import { ArtworkCache } from "./ArtworkCache";
import { TriggerDb } from "./TriggerDb";
import { SubtitlesManager } from "./Subtitles/SubtitlesManager";
import { Hookable, Hook } from "./Hookable";
import * as r from 'rethinkdb';
import * as itt from 'itt';
import { ReadWriteSemaphore, Semaphore } from "data-semaphore";
import { MediaStreamType } from "./MediaProviders/MediaStreams/MediaStream";
import { serveMedia } from "./ES2017/HttpServeMedia";
import { ScrapersManager } from "./MediaScrapers/ScrapersManager";
import { exec } from "mz/child_process";
import { ToolsManager } from "./Tools/ToolsManager";
import { ExtensionsManager } from "./ExtensionsManager";
import { Tool } from './Tools/Tool';
import { Journal } from './Journal';
import { ConsoleBackend, SharedLogger, FilterBackend, HttpRequestLogger } from 'clui-logger';
import { CommandsHistory } from './Receivers/CommandsHistory';
import { DataStore } from './DataStore';
import { AccessControl } from './AccessControl';
import { TIMESTAMP_SHORT } from 'clui-logger/lib/Backends/ConsoleBackend';
import { Relation } from './Database/Relations/Relation';
import { max } from './ES2017/Date';
import * as crypto from 'crypto';
import { collect, first, groupingBy } from 'data-collectors';

export class UnicastServer {
    readonly hooks : Hookable = new Hookable( 'error' );

    readonly onError : Hook<Error> = this.hooks.create( 'error' );
    
    readonly onStart : Hook<void> = this.hooks.create( 'start' );

    readonly onListen : Hook<void> = this.hooks.create( 'listen' );

    readonly onClose : Hook<void> = this.hooks.create( 'close' );

    readonly config : Config;

    readonly accessControl : AccessControl;

    readonly database : Database;

    readonly scrapers : ScrapersManager;

    readonly receivers : ReceiversManager;

    readonly providers : ProvidersManager;
    
    readonly media : MediaManager;

    readonly streams : HttpRawMediaServer;

    readonly tasks : BackgroundTasksManager;

    readonly storage : Storage;

    readonly dataStore : DataStore;

    readonly subtitles : SubtitlesManager;

    readonly artwork : ArtworkCache;

    readonly triggerdb : TriggerDb;

    readonly transcoding : TranscodingManager;

    readonly loggerBackend : FilterBackend;

    readonly logger : SharedLogger;

    readonly journal : Journal;

    readonly rcHistory : CommandsHistory;

    readonly commands : CommandsManager;

    readonly http : MultiServer;

    readonly httpLoggerMiddleware : HttpRequestLogger;

    readonly repositories : RepositoriesManager;

    readonly tools : ToolsManager;

    readonly extensions : ExtensionsManager;

    protected cachedIpV4 : string;

    isHttpsEnabled : boolean = false;

    constructor () {
        this.config = Config.singleton();

        this.storage = new Storage( this );
        
        this.loggerBackend = new FilterBackend( new ConsoleBackend( TIMESTAMP_SHORT ) );

        this.logger = new SharedLogger( this.loggerBackend );

        this.database = new Database( this );

        this.dataStore = new DataStore( this );
        
        this.journal = Journal.fromServer( this );

        this.tasks = new BackgroundTasksManager();

        this.accessControl = AccessControl.fromServer( this );

        this.scrapers = new ScrapersManager( this );

        this.receivers = new ReceiversManager( this );

        this.providers = new ProvidersManager( this );

        this.repositories = new RepositoriesManager( this );

        this.media = new MediaManager( this );        
   
        this.subtitles = new SubtitlesManager( this );

        this.artwork = new ArtworkCache( this );

        this.triggerdb = new TriggerDb( this );

        this.transcoding = new TranscodingManager( this );

        this.http = new MultiServer( [ restify.createServer( {
            ignoreTrailingSlash: true,
            maxParamLength: 200
            // handleUpgrades: true
        } as any ) ] );

        this.streams = new HttpRawMediaServer( this );

        this.rcHistory = new CommandsHistory( this );

        this.commands = new CommandsManager( this );

        this.tools = new ToolsManager( this );

        this.extensions = new ExtensionsManager( this );

        if ( Config.get<boolean>( 'server.ssl.enabled' ) && fs.existsSync( './server.key' ) ) {
            const keyFile = Config.get<string>( 'server.ssl.key' );
            const certFile = Config.get<string>( 'server.ssl.certificate' );
            const passphrase = Config.get<string>( 'server.ssl.passphrase' );

            if ( !fs.existsSync( keyFile ) || !fs.existsSync( certFile ) ) {
                throw new Error( `SSL enabled, but no key or certificate file found.` );
            }

            this.http.servers.push( restify.createServer( {
                ignoreTrailingSlash: true,
                maxParamLength: 200,

                key: fs.readFileSync( keyFile ),
                certificate: fs.readFileSync( certFile ),
                passphrase: passphrase
            } as restify.ServerOptions ) );

            this.isHttpsEnabled = true;
        }

        this.http.name = Config.get<string>( 'name', 'unicast' );

        const cors = corsMiddleware( { origins: [ '*' ] } );
        
        this.http.pre( cors.preflight );
        this.http.use( cors.actual );

        this.http.use( restify.plugins.queryParser() );
        this.http.use( restify.plugins.bodyParser() );
        this.http.use( ( req: restify.Request, res: restify.Response, next: restify.Next ) => {
            try {
                if ( !req.body ) {
                    req.body = {};
                } else {
                    req.body = typeof req.body === 'string' ? JSON.parse( req.body ) : req.body;
                }

                next();
            } catch ( err ) {
                console.log( err );
                next( err );
            }
        } );

        this.httpLoggerMiddleware = new HttpRequestLogger( this.logger.service( 'http' ), act => {
            return act.req.method === 'OPTIONS' || !( act.req.url.startsWith( '/api' ) || act.req.url.startsWith( '/media/send' ) ) || act.req.url.startsWith( '/api/media/artwork' );
        } );

        this.http.use( this.httpLoggerMiddleware.before() );
        this.http.on( 'after', this.httpLoggerMiddleware.after() );
        
        this.httpLoggerMiddleware.registerHighFrequencyPattern( 
            /\/media\/send\/(\w+)\/([\w\-_ ]+)\/session\/([\w\-_ ]+)\/stream\//, 
            match => match[ 1 ] + '/' + match[ 2 ] + '/' + match[ 3 ]
        );

        this.onError.subscribe( error => {
            this.logger.error( 'unhandled', error.message + error.stack, error );
        } );

        // Quick fix
        this.http.servers.forEach( server => server.server.removeAllListeners( 'upgrade' ) );
    }

    get name () {
        return this.http.name;
    }

    getIpV4 () : string {
        return this.cachedIpV4;
    }

    getPort () : number {
        return this.config.get( 'server.port' );
    }

    getSecurePort () : number {
        return this.config.get( 'server.ssl.port' );
    }

    getUrl ( path ?: string ) : string {
        return `http://${ this.getIpV4() }:${ this.getPort() }` + ( path || '' );
    }

    getSecureUrl ( path ?: string ) : string {
        return `https://${ this.getIpV4() }:${ this.getSecurePort() }` + ( path || '' );
    }

    getMatchingUrl ( req : restify.Request, path ?: string ) : string {
        if ( ( req.connection as any ).encrypted ) {
            return this.getSecureUrl( path );
        } else {
            return this.getUrl( path );
        }
    }

    async bootstrap () : Promise<void> {
        this.cachedIpV4 = await internalIp.v4();

        await this.extensions.load();

        await this.onStart.notify();
    }

    async runTools ( toolsToRun : [Tool, any][] ) : Promise<void> {
        for ( let [ tool, options ] of toolsToRun ) {
            try {
                await this.tools.run( tool, options );
            } catch ( error ) {
                tool.logger.error( error.message + '\n' + error.stack );
            }
        }
    }

    async listen () : Promise<void> {
        const port : number = this.getPort();

        const sslPort : number = this.getSecurePort();
    
        // Attach all api controllers
        this.streams.initialize();

        new ApiController( this, '/api' ).install();

        // Start the static server
        routes( this.getUrl(), this.getUrl( '/api' ) ).applyRoutes( this.http.servers[ 0 ] );

        if ( this.http.servers.length > 1 ) {
            routes( this.getSecureUrl(), this.getSecureUrl( '/api' ) ).applyRoutes( this.http.servers[ 1 ] );
        }

        await this.database.install();

        await this.http.listen( [ port, sslPort ] );
        
        await this.onListen.notify();
        
        await this.storage.clean();

        this.logger.info( this.name, this.name + ' listening on ' + this.getUrl() );
        
        if ( this.isHttpsEnabled ) {
            this.logger.info( this.name, this.name + ' listening on ' + this.getSecureUrl() );
        }
    }

    public hash ( value : string ) {
        return crypto.createHash('sha256').update( value ).digest('hex');
    }

    async run ( args ?: string[] ) : Promise<void> {
        const toolsToRun = this.tools.parse( args );

        if ( toolsToRun.length > 0 ) {
            this.loggerBackend.addPredicate( '>=error', true );
            this.loggerBackend.addPredicate( '[Tools/]', true );

            await this.bootstrap();

            await this.runTools( toolsToRun );

            await this.close();
        } else {
            await this.bootstrap();

            await this.listen();

            return new Promise<void>( () => {} );
        }
    }

    async close ( timeout : number = 0 ) {
        this.logger.info( 'unicast', 'Shutting down...' );

        await Promise.race( [
            this.onClose.notify(),
            new Promise( resolve => timeout > 0 && setTimeout( resolve, timeout ) )
        ] );
        
        this.http.close();
        
        this.logger.info( 'unicast', 'Server closed.' );
    }

    async quit ( delay : number = 0, timeout : number = 0 ) {
        try {
            await this.close( timeout );
        } catch ( err ) {
            this.onError.notify( err );
        } finally {
            if ( delay > 0 ) {
                setTimeout( () => process.exit(), delay );
            } else {
                process.exit();
            }
        }
    }
}

export class HttpRawMediaServer {
    server : UnicastServer;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    host () : string {
        return this.server.getUrl();
    }

    getUrlFor ( kind : string, id : string, stream : string ) : string {
        return `/media/raw/${ kind }/${ id }/stream/${ stream }`;
    }

    getUrlPattern () : string {
        return this.getUrlFor( ':kind', ':id', ':stream' );
    }

    initialize () {
        this.server.http.get( '/api' + this.getUrlPattern(), this.serve.bind( this ) );
        this.server.http.head( '/api' + this.getUrlPattern(), this.serve.bind( this ) );
    }

    async serve ( req : restify.Request, res : restify.Response, next : restify.Next ) : Promise<void> {
        try {
            const record = await this.server.media.get<PlayableMediaRecord>( req.params.kind, req.params.id );

            if ( !record.sources ) {
                throw new Error( `Record does not have sources.` );
            }

            const streams = await this.server.providers.streams( record.sources );

            const stream = streams.find( stream => stream.id == req.params.stream );

            let mime = stream.type === MediaStreamType.Subtitles
                ? stream.mime + ';charset=utf-8'
                : stream.mime;
            
            let reader = serveMedia( req, res, mime, stream.size, ( range ) => stream.reader( range ) );
            
            if ( reader ) {
                reader.on( 'error', () => {
                    stream.close( reader );
                } );

                req.on( 'close', () => stream.close( reader ) );
            }

            next();
        } catch ( error ) {
            this.server.onError.notify( error );
           
            res.send( 500, { error: true } );

            next();
        }
    }
}

export class MediaManager {
    readonly server  : UnicastServer;

    watchTracker : MediaWatchTracker;

    customization : MediaCustomization;

    userRanks : MediaUserRanks;

    get database () : Database {
        return this.server.database;
    }

    get providers () : ProvidersManager {
        return this.server.providers;
    }

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.watchTracker = new MediaWatchTracker( this );
        this.customization = new MediaCustomization( this );
        this.userRanks = new MediaUserRanks( this );
    }

    getTable ( kind : MediaKind ) : MediaTable<MediaRecord> {
        const tables = this.server.database.tables;

        switch ( kind ) {
            case MediaKind.Movie: return tables.movies;
            case MediaKind.TvShow: return tables.shows;
            case MediaKind.TvSeason: return tables.seasons;
            case MediaKind.TvEpisode: return tables.episodes;
            case MediaKind.Custom: return tables.custom;
            default: return null;
        }
    }

    getKind ( table: BaseTable<unknown> ) : MediaKind {
        const tables = this.server.database.tables;

        switch ( table.tableName ) {
            case tables.movies.tableName: return MediaKind.Movie;
            case tables.shows.tableName: return MediaKind.TvShow;
            case tables.seasons.tableName: return MediaKind.TvSeason;
            case tables.episodes.tableName: return MediaKind.TvEpisode;
            case tables.custom.tableName: return MediaKind.Custom;
            default: return null;
        }
    }

    get ( kind : MediaKind.Movie, id : string ) : Promise<MovieMediaRecord>;
    get ( kind : MediaKind.TvShow, id : string ) : Promise<TvShowMediaRecord>;
    get ( kind : MediaKind.TvSeason, id : string ) : Promise<TvSeasonMediaRecord>;
    get ( kind : MediaKind.TvEpisode, id : string ) :Promise<TvEpisodeMediaRecord>;
    get ( kind : MediaKind.Custom, id : string ) : Promise<CustomMediaRecord>;
    get<R extends MediaRecord = MediaRecord> ( kind : MediaKind, id : string ) : Promise<R>;
    get<R extends MediaRecord = MediaRecord> ( kind : MediaKind, id : string ) : Promise<R> {
        let table : BaseTable<R> = this.getTable( kind ) as MediaTable<R>;

        return table.get( id );
    }

    getAll ( refs : [ MediaKind, string ][] ) : Promise<MediaRecord[]> {
        return Promise.all( refs.map( ( [ kind, id ] ) => this.get( kind, id ) ) );
    }

    async loadAll<T> ( records : T[], key : string, mapper : ( T ) => [ MediaKind, string ] | { kind: MediaKind, id : string } ) : Promise<T[]> {
        const normalizedMapper = ( record : T ) => {
            const ref = mapper( record );

            if ( ref instanceof Array ) {
                return ref;
            }

            return [ ref.kind, ref.id ] as [ MediaKind, string ];
        }

        const index : any = {};

        for ( let reference of await this.getAll( records.map( normalizedMapper ) ) ) {
            index[ reference.kind + '|' + reference.id ] = reference;
        }

        for ( let record of records ) {
            const ref = normalizedMapper( record );

            record[ key ] = index[ ref[ 0 ] + '|' + ref[ 1 ] ];
        }

        return records;
    }

    async getSeason ( show : string, season : number ) : Promise<TvSeasonMediaRecord> {
        const seasons = await this.database.tables.seasons.find( query => query.filter( {
            tvShowId: show, 
            number: season
        } ).limit( 1 ) );

        if ( seasons.length ) {
            return seasons[ 0 ];
        }

        return null;
    }

    async getSeasons ( show : string ) : Promise<TvSeasonMediaRecord[]> {
        return await this.database.tables.seasons.find( query => query.filter( {
            tvShowId: show
        } ) );
    }

    async getSeasonEpisode ( season : string, episode : number ) : Promise<TvEpisodeMediaRecord> {
        const episodes = await this.database.tables.episodes.find( query => query.filter( {
            tvSeasonId: season, 
            number: episode
        } ).limit( 1 ) );

        if ( episodes.length ) {
            return episodes[ 0 ];
        }

        return null;
    }

    async getSeasonEpisodes ( season : string ) : Promise<TvEpisodeMediaRecord[]> {
        return await this.database.tables.episodes.find( query => query.filter( {
            tvSeasonId: season
        } ) );
    }

    async getEpisode ( show : string, season : number, episode : number ) : Promise<TvEpisodeMediaRecord> {
        const seasonRecord = await this.getSeason( show, season );

        if ( !seasonRecord ) {
            return null;
        }

        return this.getSeasonEpisode( seasonRecord.id, episode );
    }

    async getEpisodesBySeason ( show : string ) : Promise<Map<number, { season: TvSeasonMediaRecord, episodes: TvEpisodeMediaRecord[] }>> {
        const seasons = await this.getSeasons( show );

        const ids = seasons.map( season => season.id );

        const episodes = await this.database.tables.episodes.find( query => query.filter( doc => r.expr( ids ).contains( ( doc as any )( 'tvSeasonId' ) ) ) );

        const episodesBySeason : Map<number, { season: TvSeasonMediaRecord, episodes: TvEpisodeMediaRecord[] }> = new Map();

        for ( let episode of episodes ) {
            const season = seasons.find( season => season.id === episode.tvSeasonId );

            if ( !episodesBySeason.has( episode.seasonNumber ) ) {
                episodesBySeason.set( episode.seasonNumber, {
                    season, episodes: [ episode ]
                } );
            } else {
                episodesBySeason.get( episode.seasonNumber ).episodes.push( episode );
            }
        }

        return episodesBySeason;
    }

    async getEpisodes ( show : string ) : Promise<TvEpisodeMediaRecord[]> {
        const seasons = await this.getEpisodesBySeason( show );

        return Array.from( seasons.values() ).map( season => season.episodes ).reduce( ( a, b ) => a.concat( b ), [] );
    }

    async getCast ( media : MediaRecord ) : Promise<PersonRecord[]> {
        const table = this.getTable( media.kind );

        const cast = await table.relations.cast.load( media );

        return cast.sort( sortBy( 'cast.order' ) );
    }

    async getPlayables ( kind : MediaKind, id : string ) : Promise<PlayableMediaRecord[]> {
        if ( kind == MediaKind.TvShow ) {
            return await this.getEpisodes( id );
        } else if ( kind == MediaKind.TvSeason ) {
            return await this.getSeasonEpisodes( id );
        } else {
            return [ await this.get<PlayableMediaRecord>( kind, id ) ];
        }
    }

    store ( record : MediaRecord ) : Promise<MediaRecord> {
        let table : BaseTable<MediaRecord> = this.getTable( record.kind );

        if ( record.id ) {
            return table.update( record.id, record );
        } else {
            return table.create( record );
        }
    }

    async createFromSources ( sources : MediaSourceLike ) : Promise<MediaRecord> {
        let normalized = this.server.providers.normalizeSources( sources );

        let media = await this.server.providers.getMediaRecordFor( normalized );
        
        if ( media && media.id ) {
            let table = this.getTable( media.kind );

            const existingMedia = await table.get( media.id );

            if ( existingMedia ) {
                return existingMedia;
            }
        }

        if ( media ) {
            delete media.id;

            ( media as any ).sources = normalized;
            
            media.transient = true;

            return this.store( media );
        }

        return null;
    }

    async getCollections ( kind : MediaKind, id : string ) : Promise<CollectionRecord[]> {
        const categories = await this.database.tables.collectionsMedia.find( query => {
            return query.filter( doc => doc( 'mediaKind' ).eq( kind ).and( doc( 'mediaId' ).eq( id ) ) );
        } );

        const ids = categories.map( r => r.collectionId );

        return this.server.database.tables.collections.findAll( ids );
    }

    async getCollectionItems ( id : string ) : Promise<MediaRecord[]> {
        const items = await this.database.tables.collectionsMedia.find( query => {
            return query.filter( doc => doc( 'collectionId' ).eq( id ) );
        } );

        const ids = items.map<[MediaKind, string]>( r => ( [ r.mediaKind, r.mediaId ] ) );

        return this.getAll( ids );
    }

    async setArtwork ( media : MediaRecord, property : string, url : string ) {
        const repository = this.server.repositories.get( media.repository );

        if ( repository ) {
            repository.setPreferredMediaArt( media.kind, media.id, property, url );
        } else {
            this.server.logger.warn( 'media', `No repository named ${ media.repository } was found. Skipping setting repository.` );
        }

        media.art[ property ] = url;

        const table = this.server.media.getTable( media.kind );

        await table.update( media.id, { art: media.art } );

        // Update related media
        if ( media.kind === MediaKind.TvShow ) {
            await this.server.database.tables.seasons.updateMany( {
                tvShowId: media.id
            }, {
                art: {
                    tvshow: { 
                        [ property ]: url 
                    }
                }
            } );

            for ( let season of await this.getSeasons( media.id ) ) {
                await this.server.database.tables.episodes.updateMany( {
                    tvSeasonId: season.id
                }, {
                    art: {
                        tvshow: { 
                            [ property ]: url 
                        }
                    }
                } );
            }
        }
    }

    async updateManyIfChanged<R extends MediaRecord> ( original : R[], changed: R[], options : Partial<r.OperationOptions> = {} ): Promise<R[]> {
        if ( original.length === changed.length ) {
            throw new Error( 
                `Update many media: original and changed records should have the same length, ` +
                `instead got ${original.length} and ${changed.length}.` 
            );
        }

        for ( let [ index, record ] of original.entries() ) {
            if ( changed[ index ].kind != null && record.kind !== changed[ index ].kind ) {
                throw new Error(
                    `Update many media: Cannot change kind of index ${index} ` +
                    `from ${record.kind} to ${changed[ index ].kind}.`
                );
            }
        }
        
        return Promise.all( original.map( ( record, index ) => {
            const table = this.getTable( record.kind ) as any as BaseTable<R>;
            
            return table.updateIfChanged( record, changed[ index ], { updatedAt: new Date() }, options );
        } ) );
    }

    async humanize ( record: MediaRecord ): Promise<string> {
        if ( isTvEpisodeRecord( record ) ) {
            const season = await this.get( MediaKind.TvSeason, record.tvSeasonId );

            const show = await this.get( MediaKind.TvShow, season.tvShowId );
        
            return `${show.title} ${season.number}x${record.number} - ${record.title}`;
        } else {
            return record.title;
        }
    }
}

export class MediaCustomization {
    public mediaManager : MediaManager;

    public constructor ( mediaManager : MediaManager ) {
        this.mediaManager = mediaManager;
    }

    async save<R extends MediaRecord> ( record: R, customization: DeepPartial<R> ) {
        await this.saveMany( [ { record, customization } ] );
    }

    async saveMany ( recordCustomizations: MediaRecordCustomization<MediaRecord>[] ) {
        const customizationsByRepository = collect( recordCustomizations, groupingBy( recCust => recCust.record.repository ) );

        for ( let [ repositoryName, repositoryRecordCustomizations ] of customizationsByRepository ) {
            const repository = this.mediaManager.server.repositories.get( repositoryName );

            if ( repository == null ) {
                throw new Error( `Cannot apply customization to records, because repository "${repositoryName}" was not found.` );
            }

            for ( const entry of repositoryRecordCustomizations) {
                await repository.saveCustomization( entry.record, entry.customization );
            }
        }
        
        // Save the database
        const originalRecords = recordCustomizations.map( record => record.record );
        
        const appliedRecords = this.applyMany( recordCustomizations );

        await this.mediaManager.server.media.updateManyIfChanged( originalRecords, appliedRecords );
    }

    apply<R extends MediaRecord> ( record: R, customization: DeepPartial<R> ): R {
        return {
            ...record,
            ...customization,
        };
    }

    applyMany<R extends MediaRecord> ( recordCustomizations: MediaRecordCustomization<R>[] ) : R[] {
        return recordCustomizations.map( pair => this.apply( pair.record, pair.customization ) );
    }
}

export interface MediaRecordCustomization<R extends MediaRecord> {
    record: R;
    customization: DeepPartial<R>;
}

export type DeepPartial<T extends object> = {
    [K in keyof T] ?: T[K]
};

export class MediaUserRanks {
    public mediaManager: MediaManager;

    public lists: Map<string, MediaUserRanksList> = new Map();

    public constructor ( mediaManager: MediaManager ) {
        this.mediaManager = mediaManager;
    }

    public getList (id: string): MediaUserRanksList {
        if (this.lists.has(id)) {
            return this.lists.get(id);
        } else {
            const list = new MediaUserRanksList(this.mediaManager, id);

            this.lists.set(id, list);

            return list;
        }
    }
}

export class MediaUserRanksList {
    public mediaManager: MediaManager;

    public id: string;

    public semaphore: ReadWriteSemaphore;

    public constructor ( mediaManager: MediaManager, id: string ) {
        this.mediaManager = mediaManager;
        this.id = id;
        this.semaphore = new ReadWriteSemaphore( 1 );
    }

    public async getRecordInRank ( rank: number ) : Promise<MediaRecord> {
        if (rank == 0) {
            throw new Error(`Invalid record rank: 0`);
        }

        const userRank = await this.mediaManager.database.tables.userRanks.findOne( query => query.filter( {
            list: this.id,
            position: rank,
        } ) );

        if ( userRank == null ) {
            return null;
        }

        const { kind, id } = userRank.reference;
        
        return await this.mediaManager.get( kind, id );
    }

    public async getRecordRank ( record: MediaRecord ) : Promise<number> {
        const userRank = await this.mediaManager.database.tables.userRanks.findOne( query => query.filter( {
            list: this.id,
            reference: { kind: record.kind, id: record.id },
        } ) );

        if ( userRank == null ) {
            return 0;
        }

        return userRank.position;
    }

    protected async getModifiedRange ( ranks: number[] ): Promise<Map<number, UserRankRecord>> {
        ranks = ranks.filter( n => n > 0 );

        if ( ranks.length == 0 ) {
            return new Map();
        }

        const min = Math.min( ...ranks );
        const max = Math.max( ...ranks );

        const records = await this.mediaManager.database.tables.userRanks.find( query => {
            return query.between( min, max, { index: 'position', rightBound: 'closed' } as any ).filter( { list: this.id } );
        } );

        return collect( records, groupingBy( rank => rank.position, first() ) );
    }

    public async getTopRank () : Promise<number> {
        return await this.mediaManager.database.tables.userRanks.findStream( query => {
            return query.orderBy( { index: r.desc( 'position' ) } )
                .filter( { list: this.id } )
                .limit( 1 );
        } ).map( row => row.position ).first() ?? 0;
    }

    protected async getRecordAndRank ( recordOrRank: MediaRecord | number ): Promise<[MediaRecord, number]> {
        if ( typeof recordOrRank === 'number' ) {
            return [ await this.getRecordInRank( recordOrRank ), recordOrRank ];
        } else {
            return [ recordOrRank, await this.getRecordRank( recordOrRank ) ];
        }
    }

    /**
     * Placing some records after another one.
     * The positions are in descending order, meaning the greatest position is
     * the first one. Position 1 is the last.
     * The position zero is reserved for all media records not ordered. It is
     * the only position in a list that can contain multiple records.
     * 
     * To place (or set the rank of) something AFTER something else means (anchor), 
     * to put their ranks, if anchor rank is N, as N + 1, N + 2, etc...
     * 
     * When performing this update there are some possible states. To understand them
     * let's consider the following list:
     *    id : A B C D E F G H
     *    pos: 8 7 6 5 4 3 2 1
     * 
     * If we call setRankAfter(D, [ B, F, G, I ] ), the resulting list ought to be:
     *    id : A C D B F G I E H
     *    pos: 9 8 7 6 5 4 3 2 1
     * 
     * There are some things to note:
     *   1. Since we added I to the list, everything to the right of D had to
     *      be incremented by 1 (the number or new elements)
     *   2. Since we moved B (which was before D) to after D, then D's position
     *      has to be incremented by 1 (the number of elements shifted that sides)
     *   3. D's new position will be `PositionD + BeforeD + NewElements`
     *   4. All the items in the list will have new positions calculated as:
     *      `NewPositionD - index + 1`
     *   5. All the items between B and G, that were not in the list, will have
     *      their positions updated
     *       5.1. If their original position is < PositionD, then their new position
     *            is NewPositionD + 1 + index  
     *      
     * 
     * @param anchor 
     * @param trailings 
     */
    public async setRankBefore ( anchorOrPosition: MediaRecord | number, trailings: MediaRecord[] ) {
        const [ anchor, anchorRank ] = await this.getRecordAndRank( anchorOrPosition );
        
        const table = this.mediaManager.database.tables.userRanks;

        // Validate if there are duplicate records in the trailings/anchor
        const allRecords = [ ...trailings ];

        if ( anchor != null ) allRecords.push( anchor );

        const recordsById = collect( allRecords, groupingBy( record => record.kind + '-' + record.id ) );

        for ( const [ id, records ] of recordsById.entries() ) {
            if ( records.length > 1 ) {
                throw new Error( `Cannot move the rank of the same record more than once in the same op: ${ id }` );
            }
        }

        const trailingsRanks = await Promise.all( trailings.map( record => this.getRecordRank( record ) ) );

        if ( anchorRank == 0 ) {
            throw new Error( `Anchor rank cannot be zero por positional ranking` );
        }

        const modifiedRange = await this.getModifiedRange( [ anchorRank, ...trailingsRanks ] );

        // How many of the ones we're moving have rank zero, i.e. are not yet in the list
        const zerosCount = trailingsRanks.reduce( (acc, n) => acc + Number( n == 0 ), 0 );
        // How many records were already on the list, but before the anchor
        const beforeCount = trailingsRanks.reduce( (acc, n) => acc + Number( n > anchorRank ), 0 );

        // 1. If we are creating new positions into the list, we must update all
        // user ranks >= anchorRank to be += zerosCount
        if ( zerosCount > 0 ) {
            const filter = row => row( 'list' ).eq( this.id )
                .and( row( 'position' ).ge( anchorRank ) );

            const change = { 
                position: r.row( 'position' ).add( zerosCount )
            };

            await table.updateMany( filter, change );

            // Replicate the changes of the DB on our memory slice of it
            for ( const rank of modifiedRange.values() ) {
                if ( rank.position >= anchorRank ) {
                    rank.position += zerosCount;
                }
            }
        }

        const changes = new RankChangeSet();

        // 3. Calculate (and update) the new achor position
        const anchorRankNew = anchorRank + zerosCount + beforeCount;

        if ( modifiedRange.has( anchorRank ) ) {   
            // Move the Anchor
            changes.move( modifiedRange.get( anchorRank ).id, anchorRankNew - modifiedRange.get( anchorRank ).position );
            
            modifiedRange.delete( anchorRank )
        }

        // 4. Update the positions of the records that were explicitly moved
        for ( const [ index, record ] of trailings.entries() ) {
            const oldPosition = trailingsRanks[ index ];
            const newPosition = anchorRankNew - index - 1;

            if ( oldPosition == 0 ) {
                changes.create( {
                    list: this.id,
                    reference: { kind: record.kind, id: record.id },
                    position: newPosition,
                } )
            } else {
                const rank = modifiedRange.get( oldPosition );

                modifiedRange.delete( oldPosition );

                changes.move( rank.id, newPosition - rank.position );
            }
        }

        // 5. If there are still any 
        if ( modifiedRange.size > 0 ) {
            const recordsBeforeAnchor = Array.from( modifiedRange.values() )
                .filter( row => row.position > anchorRank )
                .sort( sortBy( '-position' ) );

            // Records higher (to the left) of the anchor
            for ( const [ index, rank ] of recordsBeforeAnchor.entries() ) {
                const newPosition = anchorRankNew + recordsBeforeAnchor.length - index;

                changes.move( rank.id, newPosition - rank.position );
            }

            const recordsAfterAnchor = Array.from( modifiedRange.values() )
                .filter( row => row.position < anchorRank )
                .sort( sortBy( '-position' ) );

            // Records lower (to the right) of the last moved item and the anchor
            for ( const [ index, rank ] of recordsAfterAnchor.entries() ) {
                const newPosition = anchorRankNew - trailings.length - index - 1;

                changes.move( rank.id, newPosition - rank.position );
            }
        }

        await changes.apply( table );
    }

    public async setRankAfter ( anchor: MediaRecord, leadings: MediaRecord[] ) {
        const anchorRank = await this.getRecordRank( anchor );

        // TODO What if the data in the database is messed up and not contiguous?
        const beforeAnchor = await this.getRecordInRank( anchorRank + 1 );

        if ( beforeAnchor == null ) {
            return await this.setRankBefore( anchorRank + 1, leadings );
        } else {
            return await this.setRankBefore( beforeAnchor, leadings );
        }
    }

    public async setRankToBottom ( records: MediaRecord[] ) {
        return await this.setRankBefore( 1, records );
    }

    public async setRankToTop ( records: MediaRecord[] ) {
        const topRank = await this.getTopRank();

        return await this.setRankBefore( topRank + 1, records );
    }

    public async getRanks () : Promise<UserRankRecord[]> {
        return await this.mediaManager.server.database.tables.userRanks.find( query => {
            return query.orderBy( { index: 'position' } );
        } );
    }

    public async getRecords () : Promise<MediaRecord[]> {
        const ranks = await this.getRanks();

        await this.mediaManager.server.database.tables.userRanks.relations.record.applyAll( ranks );

        return ranks.map( rank => ( rank as any ).record );
    }

    public async truncate () {
        const table = this.mediaManager.database.tables.userRanks;

        return await table.deleteMany({ list: this.id });
    }
}

export class RankChangeSet {
    protected moves = new Map<number, string[]>();

    protected creations: UserRankRecord[] = [];

    public move ( id: string, offset: number ) {
        if ( offset == 0 ) {
            return;
        }

        let idArray = this.moves.get( offset );

        if ( idArray == null ) {
            idArray = [ id ];

            this.moves.set( offset, idArray );
        } else {
            idArray.push( id );
        }
    }

    public create ( rank: UserRankRecord ): void {
        this.creations.push( rank );
    }

    public async apply ( table: UserRanksTable ): Promise<void> {
        const updates = Array.from( this.moves ).map( tuple => {
            const [ offset, ids ] = tuple;

            return table.updateMany( doc => r.expr( ids ).contains( doc( 'id' ) ), {
                position: r.row( 'position' ).add( offset )
            } );
        } );

        const inserts = table.createMany( this.creations );

        await Promise.all( [
            Promise.all( updates ), 
            inserts 
        ] );
    }
}

export class MediaWatchTracker {
    mediaManager : MediaManager;

    public excludedReceivers : Set<string> = new Set();

    protected semaphore : Semaphore = new Semaphore( 1 );

    constructor ( mediaManager : MediaManager ) {
        this.mediaManager = mediaManager;

        this.excludedReceivers = new Set( this.mediaManager.server.config.get( 'server.excludeFromPlayCount', [] ) );

        const historyTable = this.mediaManager.database.tables.history;

        historyTable.onCreate.subscribe( async session => {
            const record = await historyTable.relations.record.load( session );

            // Allow media played in some receivers to not be included
            if ( !this.excludedReceivers.has( session.receiver ) ) {
                await this.onPlay( record, session.createdAt );
            }
        } );
        
        historyTable.onDelete.subscribe( async session => {
            const record = await historyTable.relations.record.load( session );
            
            // Allow media played in some receivers to not be included
            if ( !this.excludedReceivers.has( session.receiver ) ) {
                await this.onPlayRepair( record );
            }
        } );
    }
    
    protected async watchTvEpisodesBatch ( customQuery : any, watched : boolean ) : Promise<TvEpisodeMediaRecord[]> {
        const episodes = await this.mediaManager.database.tables.episodes.find( query => 
            query.filter( doc => ( r as any ).and( customQuery( doc ), doc( 'watched' ).eq( r.expr( !watched ) ) ) )    
        );

        // When watched, only increment the play count of episodes whose play count equals zero
        await this.mediaManager.database.tables.episodes.updateMany(
            doc => ( r as any ).and( customQuery( doc ), doc( 'watched' ).eq( r.expr( !watched ) ) ),
            { watched }
        );
        
        for ( let episode of episodes ) {
            // MARK UNAWAITED
            this.mediaManager.server.repositories.watch( episode, watched );
        }

        return episodes;
    }

    async watchTvShow ( show : TvShowMediaRecord, watched : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            // First, list all seasons belonging to this TV Show
            const seasons = await this.mediaManager.database.tables.seasons.find( query => query.filter( {
                tvShowId: show.id
            } ) );
    
            // Then compile all their ids
            const seasonIds = seasons.map( season => season.id );
    
            // And get all episodes that belong to those seasons and are or are not watched, depending on what change we are making
            const episodes = await this.watchTvEpisodesBatch( doc => r.expr( seasonIds ).contains( doc( 'tvSeasonId' ) ), watched );

            for ( let season of seasons ) {
                await this.mediaManager.database.tables.seasons.update( season.id, {
                    watchedEpisodesCount: watched ? season.episodesCount : 0
                } );
            }
    
            await this.mediaManager.database.tables.shows.update( show.id, {
                watchedEpisodesCount: watched ? itt( seasons ).map( season => season.episodesCount ).sum() : 0,
                watched: watched
            } );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watchTvSeason ( season : TvSeasonMediaRecord, watched : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            const episodes = await this.watchTvEpisodesBatch( doc => doc( 'tvSeasonId' ).eq( r.expr( season.id ) ), watched );
    
            const difference = ( watched ? season.episodesCount : 0 ) - season.watchedEpisodesCount;
    
            await this.mediaManager.database.tables.seasons.update( season.id, {
                watchedEpisodesCount: watched ? season.episodesCount : 0
            } );
    
            const show = await this.mediaManager.database.tables.shows.get( season.tvShowId );
    
            await this.mediaManager.database.tables.shows.update( season.tvShowId, {
                watchedEpisodesCount: show.watchedEpisodesCount + difference,
                watched: show.watchedEpisodesCount + difference >= show.episodesCount
            } );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watchTvEpisode ( episode : TvEpisodeMediaRecord, watched : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            episode = await this.mediaManager.database.tables.episodes.get( episode.id );

            if ( !watched && !episode.watched ) {
                return;
            }

            await this.mediaManager.database.tables.episodes.update( episode.id, { watched } );

            // MARK UNAWAITED            
            this.mediaManager.server.repositories.watch( episode, watched );

            const similarEpisodes = await this.mediaManager.database.tables.episodes.find( query => query.filter( {
                watched: true,
                tvSeasonId: episode.tvSeasonId,
                number: episode.number
            } ) );

            if ( ( watched && similarEpisodes.length === 1 ) || ( !watched && similarEpisodes.length === 0 ) ) {
                await this.mediaManager.database.tables.seasons.update( episode.tvSeasonId, {
                    watchedEpisodesCount: r.row( 'watchedEpisodesCount' ).add( watched ? 1 : -1 )
                } );
        
                const season = await this.mediaManager.database.tables.seasons.get( episode.tvSeasonId );
        
                await this.mediaManager.database.tables.shows.update( season.tvShowId, {
                    watchedEpisodesCount: r.row( 'watchedEpisodesCount' ).add( watched ? 1 : -1 ),
                    watched: r.row( 'watchedEpisodesCount' ).add( watched ? 1 : -1 ).eq( r.row( 'episodesCount' ) ),
                } );
            }
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watchMovie ( movie : MovieMediaRecord, watched : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            movie = await this.mediaManager.database.tables.movies.get( movie.id );

            if ( !watched && !movie.watched ) {
                return;
            }

            await this.mediaManager.database.tables.movies.update( movie.id, { watched } );

            // MARK UNAWAITED
            await this.mediaManager.server.repositories.watch( movie, watched );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watchCustom ( custom : CustomMediaRecord, watched : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            custom = await this.mediaManager.database.tables.custom.get( custom.id );

            if ( !watched && !custom.watched ) {
                return;
            }

            await this.mediaManager.database.tables.custom.update( custom.id, { watched } );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watch ( media : MediaRecord, watched : boolean = true ) {
        if ( isMovieRecord( media ) ) {
            return this.watchMovie( media, watched );
        } else if ( isTvShowRecord( media ) ) {
            return this.watchTvShow( media, watched );
        } else if ( isTvSeasonRecord( media ) ) {
            return this.watchTvSeason( media, watched );
        } else if ( isTvEpisodeRecord( media ) ) {
            return this.watchTvEpisode( media, watched );
        } else if ( isCustomRecord( media ) ) {
            return this.watchCustom( media, watched );
        }
    }
    
    protected async onPlaySingle<T extends PlayableMediaRecord> ( table : MediaTable<T>, record : T, playDate: Date = new Date() ) : Promise<T> {
        // Make sure we have the most recent information regarding this media record
        record = await table.get( record.id );

        const lastPlayedAt = max( record.lastPlayedAt, playDate );

        await table.update( record.id, { 
            lastPlayedAt, playCount: r.row( 'playCount' ).add( 1 ) 
        } );

        record.lastPlayedAt = lastPlayedAt;
        record.playCount = ( record.playCount ?? 0 ) + 1;

        return record;
    }

    public async onPlayContainerChanges<P extends MediaRecord, C extends MediaRecord> ( table : MediaTable<P>, parent : P, relation : Relation<P, C[]> | C[] ) : Promise<Partial<MediaRecord>> {
        parent = await table.get( parent.id );

        const allChildren = relation instanceof Relation
            ? await relation.load( parent )
            : relation;

        const lastPlayedAt = allChildren.reduce( ( date, record ) => max( date, record.lastPlayedAt ), null as Date );

        const defaultPlayCount = allChildren.length > 0 ? allChildren[ 0 ].playCount : 0;

        const playCount = allChildren.reduce( ( count, record ) => Math.min( count, record.playCount ?? 0 ), defaultPlayCount );

        return { lastPlayedAt, playCount };
    }

    protected async onPlayContainer<P extends MediaRecord, C extends MediaRecord> ( table : MediaTable<P>, parent : P, relation : Relation<P, C[]> ) : Promise<P> {
        const changes = await this.onPlayContainerChanges( table, parent, relation );

        await table.update( parent.id, changes );

        Object.assign( parent, changes );

        return parent;
    }

    async onPlayMovie ( movie : MovieMediaRecord, playDate: Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            await this.onPlaySingle( this.mediaManager.database.tables.movies, movie, playDate );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }
    
    async onPlayTvEpisode ( episode : TvEpisodeMediaRecord, playDate: Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            const tables = this.mediaManager.database.tables;

            episode = await this.onPlaySingle( tables.episodes, episode, playDate );

            let season = await this.mediaManager.get( MediaKind.TvSeason, episode.tvSeasonId );

            season = await this.onPlayContainer( 
                tables.seasons, 
                season,
                tables.seasons.relations.episodes,
            );

            let show = await this.mediaManager.get( MediaKind.TvShow, season.tvShowId );

            show = await this.onPlayContainer( 
                tables.shows, 
                show, 
                tables.shows.relations.seasons,
            );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }
    
    async onPlayCustom ( custom : CustomMediaRecord, playDate: Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            await this.onPlaySingle( this.mediaManager.database.tables.custom, custom, playDate );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async onPlay ( media : MediaRecord, playDate : Date = new Date() ) {
        if ( isMovieRecord( media ) ) {
            return this.onPlayMovie( media, playDate );
        } else if ( isTvEpisodeRecord( media ) ) {
            return this.onPlayTvEpisode( media, playDate );
        } else if ( isCustomRecord( media ) ) {
            return this.onPlayCustom( media, playDate );
        }
    }
    
    /* On Play Repair */
    public async onPlayRepairSingleChanges<T extends MediaRecord> ( table : MediaTable<T>, record : T ) : Promise<Partial<MediaRecord>> {
        record = await table.get( record.id );

        let recordSessions = await this.mediaManager.database.tables.history.findAll(
            [ [ record.kind, record.id ] ], { index: 'reference' }
        );

        recordSessions = recordSessions.filter( session => !this.excludedReceivers.has( session.receiver ) );

        const playCount = recordSessions.length;

        const lastPlayedAt = recordSessions.reduce( ( date, session ) => max( date, session.createdAt ), null as Date );

        return { lastPlayedAt, playCount };
    }

    protected async onPlayRepairSingle<T extends PlayableMediaRecord> ( table : MediaTable<T>, record : T ) : Promise<T> {
        const changes = await this.onPlayRepairSingleChanges( table, record );

        await table.update( record.id, changes );

        Object.assign( record, changes );

        return record;
    }

    public async onPlayRepairMovie ( movie : MovieMediaRecord ) {
        const release = await this.semaphore.acquire();

        try {
            await this.onPlayRepairSingle( this.mediaManager.database.tables.movies, movie );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    public async onPlayRepairTvShow ( show : TvShowMediaRecord ) {
        const release = await this.semaphore.acquire();

        try {
            const tables = this.mediaManager.database.tables;

            show = await this.mediaManager.get( MediaKind.TvShow, show.id );

            show = await this.onPlayContainer( 
                tables.shows, 
                show, 
                tables.shows.relations.seasons,
            );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    public async onPlayRepairTvSeason ( season : TvSeasonMediaRecord, updateContainer : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            const tables = this.mediaManager.database.tables;

            season = await this.mediaManager.get( MediaKind.TvSeason, season.id );

            season = await this.onPlayContainer( 
                tables.seasons, 
                season,
                tables.seasons.relations.episodes,
            );

            if ( updateContainer ) {
                let show = await this.mediaManager.get( MediaKind.TvShow, season.tvShowId );
    
                show = await this.onPlayContainer( 
                    tables.shows, 
                    show, 
                    tables.shows.relations.seasons,
                );
            }
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    public async onPlayRepairTvEpisode ( episode : TvEpisodeMediaRecord, updateContainer : boolean = true ) {
        const release = await this.semaphore.acquire();

        try {
            const tables = this.mediaManager.database.tables;

            episode = await this.onPlayRepairSingle( tables.episodes, episode );

            if ( updateContainer ) {
                // The rest is the same as the onPlayTvEpisode method
                let season = await this.mediaManager.get( MediaKind.TvSeason, episode.tvSeasonId );
    
                season = await this.onPlayContainer( 
                    tables.seasons, 
                    season,
                    tables.seasons.relations.episodes,
                );
    
                let show = await this.mediaManager.get( MediaKind.TvShow, season.tvShowId );
    
                show = await this.onPlayContainer( 
                    tables.shows, 
                    show, 
                    tables.shows.relations.seasons,
                );
            }
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    public async onPlayRepairCustom ( custom : CustomMediaRecord ) {
        const release = await this.semaphore.acquire();

        try {
            await this.onPlayRepairSingle( this.mediaManager.database.tables.custom, custom );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async onPlayRepair ( media : MediaRecord, updateContainer : boolean = true ) {
        if ( isMovieRecord( media ) ) {
            return this.onPlayRepairMovie( media );
        } else if ( isTvShowRecord( media ) ) {
            return this.onPlayRepairTvShow( media );
        } else if ( isTvSeasonRecord( media ) ) {
            return this.onPlayRepairTvSeason( media, updateContainer );
        } else if ( isTvEpisodeRecord( media ) ) {
            return this.onPlayRepairTvEpisode( media, updateContainer );
        } else if ( isCustomRecord( media ) ) {
            return this.onPlayRepairCustom( media );
        }
    }

    async onPlayRepairChanges ( media : MediaRecord, context?: PlayRepairChangesContext ) : Promise<Partial<MediaRecord>> {
        const tables = this.mediaManager.database.tables;

        if ( isMovieRecord( media ) ) {
            return this.onPlayRepairSingleChanges( tables.movies, media );
        } else if ( isTvShowRecord( media ) ) {
            return this.onPlayContainerChanges( tables.shows, media, context.seasons ?? tables.shows.relations.seasons );
        } else if ( isTvSeasonRecord( media ) ) {
            return this.onPlayContainerChanges( tables.seasons, media, context.episodes ?? tables.seasons.relations.episodes );
        } else if ( isTvEpisodeRecord( media ) ) {
            return this.onPlayRepairSingleChanges( tables.episodes, media );
        } else if ( isCustomRecord( media ) ) {
            return this.onPlayRepairSingleChanges( tables.custom, media );
        }
    }
}

export interface PlayRepairChangesContext {
    seasons?: TvSeasonMediaRecord[];
    episodes?: TvEpisodeMediaRecord[];
}

export interface Route extends restify.RouteOptions {
    method : string;
    childRoutes ?: restify.Route[]
    querySchema ?: TypeSchema;
    bodySchema ?: TypeSchema;
}

export class MultiServer extends EventEmitter {
    servers : restify.Server[] = [];

    routes : Route[] = [];

    constructor ( servers : restify.Server[] = [] ) {
        super();

        this.servers = servers;

        for ( let server of this.servers ) {
            server.on( 'after', ( ...args : any[] ) => this.emit( 'after', ...args ) );
        }
    }
    
    address () : restify.AddressInterface {
        return this.servers[ 0 ].address();
    }

    listen ( ports : number[] ) : Promise<void> {
        return Promise.all( this.servers.map( ( server, index ) => {
            return new Promise<void>( resolve => {
                server.listen( ports[ index ], () => {
                    resolve();
                } );
            } );
        } ) ).then( () => null );
    }

    async close () {
        let promises : Promise<void>[] = [];

        for ( let server of this.servers ) {
            promises.push( 
                new Promise<void>( 
                    resolve => server.close( resolve ) 
                )
            );
        }

        await Promise.all( promises );
    }

    inflightRequests (): number {
        return this.servers.reduce( ( s, server ) => s + server.inflightRequests(), 0 );
    }

    protected addRoute ( opts: string | RegExp | restify.RouteOptions, method : string = null ): Route {
        let route : restify.RouteOptions = null;

        if ( typeof opts === 'string' ) {
            route = { path: opts };
        } else if ( opts instanceof RegExp ) {
            route = { path: opts };
        } else {
            route = opts;
        }

        const createdRoute: Route = {
            ...route,
            method: method || 'all',
        };

        this.routes.push( createdRoute );

        return createdRoute;
    }

    del ( opts: string | RegExp | Route, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.del( opts, ...handlers ) );

        return this.addRoute( opts, 'del' );
    }

    get ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.get( opts, ...handlers ) );

        return this.addRoute( opts, 'get' );
    }

    head ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.head( opts, ...handlers ) );

        return this.addRoute( opts, 'head' );
    }

    opts ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.opts( opts, ...handlers ) );

        return this.addRoute( opts, 'opts' );
    }

    post ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.post( opts, ...handlers ) );

        return this.addRoute( opts, 'post' );
    }

    put ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.put( opts, ...handlers ) );

        return this.addRoute( opts, 'put' );
    }

    patch ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) {
        this.servers.map( server => server.patch( opts, ...handlers ) );

        return this.addRoute( opts, 'patch' );
    }

    param ( name : string, fn : restify.RequestHandler ) : this {
        for ( let server of this.servers ) {
            server.param( name, fn );
        }

        return this;
    }

    versionedUse ( versions : string | string[], fn : restify.RequestHandler ) : this {
        for ( let server of this.servers ) {
            server.versionedUse( versions, fn );
        }
        
        return this;
    }

    rm ( route : string ) : boolean {
        return this.servers.every( server => server.rm( route ) );
    }

    use ( ...handlers : restify.RequestHandlerType[] ) : this {
        for ( let server of this.servers ) {
            server.use( ...handlers );
        }
        
        return this;
    }

    pre ( ...pre : restify.RequestHandlerType[] ) : this {
        for ( let server of this.servers ) {
            server.pre( ...pre );
        }

        return this;
    }

    toString () : string {
        return this.servers.map( server => server.toString() ).join( '\n' );
    }

    getDebugInfo () : any[] {
        return this.servers.map( server => server.getDebugInfo() );
    }

    get name () : string {
        return this.servers[ 0 ].name;
    }

    set name ( name : string ) {
        for ( let server of this.servers ) {
            server.name = name;
        }
    }

    get url () : string {
        return this.servers[ 0 ].url;
    }

    get log () {
        return this.servers[ 0 ].log;
    }
}

export class CommandsManager {
    server : UnicastServer;
    
    events : {
        [ key : string ]: string
    } = {};

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.events = this.server.config.get<any>( 'execute', {} );

        this.server.onStart.subscribe( this.onStart.bind( this ) );
        this.server.onClose.subscribe( this.onClose.bind( this ) );
    }

    runHooks ( binding : string ) {
        if ( binding in this.events && this.events[ binding ] ) {
            exec( this.events[ binding ] );
        }
    }
    
    onStart () {
        return this.runHooks( 'onStart' );
    }

    onClose () {
        return this.runHooks( 'onClose' );
    }
}