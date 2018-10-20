import { ProvidersManager, MediaSourceLike } from "./MediaProviders/ProvidersManager";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, MediaRecord, CustomMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord, MovieMediaRecord, PlayableMediaRecord } from "./MediaRecord";
import { Database, BaseTable, CollectionRecord, MediaTable } from "./Database/Database";
import { Config } from "./Config";
import * as restify from 'restify';
import * as logger from 'restify-logger';
import { ReceiversManager } from "./Receivers/ReceiversManager";
import { routes } from 'unicast-interface';
import * as internalIp from 'internal-ip';
import * as corsMiddleware from 'restify-cors-middleware';
import { ApiController } from "./Controllers/ApiControllers/ApiController";
import * as chalk from 'chalk';
import { ResourceNotFoundError } from 'restify-errors';
import { BackgroundTasksManager } from "./BackgroundTask";
import { Storage } from "./Storage";
import { TranscodingManager } from "./Transcoding/TranscodingManager";
import * as fs from 'mz/fs';
import { EventEmitter } from "events";
import { ArtworkCache } from "./ArtworkCache";
import { Diagnostics } from "./Diagnostics";
import { TriggerDb } from "./TriggerDb";
import { SubtitlesManager } from "./Subtitles/SubtitlesManager";
import { Hookable, Hook } from "./Hookable";
import * as r from 'rethinkdb';
import * as itt from 'itt';
import { Semaphore } from "data-semaphore";
import { MediaStreamType } from "./MediaProviders/MediaStreams/MediaStream";
import { serveMedia } from "./ES2017/HttpServeMedia";
import { ScrapersManager } from "./MediaScrapers/ScrapersManager";
import { exec } from "mz/child_process";
import { ToolsManager } from "./Tools/ToolsManager";

export class UnicastServer {
    readonly hooks : Hookable = new Hookable();

    readonly onStart : Hook<void> = this.hooks.create( 'start' );

    readonly onListen : Hook<void> = this.hooks.create( 'listen' );
    
    readonly onError : Hook<Error> = this.hooks.create( 'error' );

    readonly onClose : Hook<void> = this.hooks.create( 'close' );

    readonly config : Config;

    readonly database : Database;

    readonly scrapers : ScrapersManager;

    readonly receivers : ReceiversManager;

    readonly providers : ProvidersManager;
    
    readonly media : MediaManager;

    readonly streams : HttpRawMediaServer;

    readonly tasks : BackgroundTasksManager;

    readonly storage : Storage;

    readonly subtitles : SubtitlesManager;

    readonly artwork : ArtworkCache;

    readonly triggerdb : TriggerDb;

    readonly transcoding : TranscodingManager;

    readonly diagnostics : Diagnostics;

    readonly commands : CommandsManager;

    readonly http : MultiServer;

    readonly repositories : RepositoriesManager;

    readonly tools : ToolsManager;

    protected cachedIpV4 : string;

    isHttpsEnabled : boolean = false;

    constructor () {
        this.config = Config.singleton();

        this.storage = new Storage( this );
        
        this.diagnostics = new Diagnostics( this );

        this.database = new Database( this );

        this.tasks = new BackgroundTasksManager();

        this.scrapers = new ScrapersManager( this );

        this.receivers = new ReceiversManager( this );

        this.providers = new ProvidersManager( this );

        this.repositories = new RepositoriesManager( this );

        this.media = new MediaManager( this );        
   
        this.subtitles = new SubtitlesManager( this );

        this.artwork = new ArtworkCache( this );

        this.triggerdb = new TriggerDb( this );
        
        this.transcoding = new TranscodingManager( this );

        this.http = new MultiServer( [ restify.createServer() ] );

        this.streams = new HttpRawMediaServer( this );

        this.commands = new CommandsManager( this );

        this.tools = new ToolsManager( this );

        if ( Config.get<boolean>( 'server.ssl.enabled' ) && fs.existsSync( './server.key' ) ) {
            const keyFile = Config.get<string>( 'server.ssl.key' );
            const certFile = Config.get<string>( 'server.ssl.certificate' );
            const passphrase = Config.get<string>( 'server.ssl.passphrase' );

            if ( !fs.existsSync( keyFile ) || !fs.existsSync( certFile ) ) {
                throw new Error( `SSL enabled, but no key or certificate file found.` );
            }

            this.http.servers.push( restify.createServer( {
                key: fs.readFileSync( keyFile ),
                certificate: fs.readFileSync( certFile ),
                passphrase: passphrase
            } ) );

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
        } )

        // Set logger format
        logger.format( 'unicast-simple', `${chalk.blue( `[${this.http.name}]` ) } ${ chalk.green( ':method' ) } ${ chalk.cyan( ':url' ) } ${ chalk.grey( ':status' ) } :response-time ms` )
        
        // Attach the logger
        this.http.use( logger( 'unicast-simple', {
            skip( req: restify.Request ) {
                return req.method === 'OPTIONS' || !( req.url.startsWith( '/api' ) || req.url.startsWith( '/media/send' ) ) || req.url.startsWith( '/api/media/artwork' );
            }
        } ) );

        this.onError.subscribe( error => {
            this.diagnostics.error( 'unhandled', error.message, error );
        } );
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

    async listen () : Promise<void> {
        this.cachedIpV4 = await internalIp.v4();

        await this.onStart.notify();

        const port : number = this.getPort();

        const sslPort : number = this.getSecurePort();
    
        // Attach all api controllers
        new ApiController( this, '/api' ).install();

        this.http.use( ( req, _res, next ) => {
            if ( req.url.startsWith( '/api/' ) ) {
                next( new ResourceNotFoundError( `Could not find the resource "${ req.url }"` ) );
            }

            next();
        } );

        // Start the static server
        routes( this.getUrl(), this.getUrl( '/api' ) ).applyRoutes( this.http.servers[ 0 ] );

        if ( this.http.servers.length > 1 ) {
            routes( this.getSecureUrl(), this.getSecureUrl( '/api' ) ).applyRoutes( this.http.servers[ 1 ] );
        }

        await this.database.install();

        await this.http.listen( [ port, sslPort ] );
        
        await this.onListen.notify();
        
        await this.storage.clean();

        this.diagnostics.info( this.name, this.name + ' listening on ' + this.getUrl() );
        
        if ( this.isHttpsEnabled ) {
            this.diagnostics.info( this.name, this.name + ' listening on ' + this.getSecureUrl() );
        }
    }

    async run ( args ?: string[] ) : Promise<void> {
        const toolsToRun = this.tools.parse( args );

        if ( toolsToRun.length > 0 ) {
            for( let [ tool, options ] of toolsToRun ) {
                try {
                    await this.tools.run( tool, options );
                } catch ( error ) {
                    console.error( error.message, error.stack );
                }
            }

            await this.close();
        } else {
            await this.listen();
        }
    }

    async close ( timeout : number = 0 ) {
        this.diagnostics.info( 'unicast', 'Shutting down...' );

        await Promise.race( [
            this.onClose.notify(),
            new Promise( resolve => timeout > 0 && setTimeout( resolve, timeout ) )
        ] );
        
        this.http.close();
        
        this.diagnostics.info( 'unicast', 'Server closed.' );
    }

    async quit ( delay : number = 0, timeout : number = 0 ) {
        try {
            await this.close( timeout );
        } catch ( err ) {
            console.error( err.message, err.stack );
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

        this.server.http.get( this.getUrlPattern(), this.serve.bind( this ) );
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
            
            reader.on( 'error', () => {
                if ( reader ) {
                    stream.close( reader );
                }
            } );
            
            if ( reader ) {
                req.on( 'close', () => stream.close( reader ) );
            }

            next();
        } catch ( error ) {
           console.error( error ) ;

           res.send( 500, { error: true } );

           next();
        }
    }
}

export class MediaManager {
    readonly server  : UnicastServer;

    watchTracker : MediaWatchTracker;

    get database () : Database {
        return this.server.database;
    }

    get providers () : ProvidersManager {
        return this.server.providers;
    }

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.watchTracker = new MediaWatchTracker( this );
    }

    getTable ( kind : MediaKind ) : MediaTable<MediaRecord> {
        const tables = this.server.database.tables;

        switch ( kind ) {
            case MediaKind.Movie: return tables.movies;
            case MediaKind.TvShow: return tables.shows;
            case MediaKind.TvSeason: return tables.seasons;
            case MediaKind.TvEpisode: return tables.episodes;
            case MediaKind.Custom: return tables.custom;
        }

        return null;
    }

    get ( kind : MediaKind.Movie, id : string ) : Promise<MediaRecord>;
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
}

export class MediaWatchTracker {
    mediaManager : MediaManager;

    protected semaphore : Semaphore = new Semaphore( 1 );

    constructor ( mediaManager : MediaManager ) {
        this.mediaManager = mediaManager;
    }

    protected async watchTvEpisodesBatch ( customQuery : any, watched : boolean, watchedAt : Date ) : Promise<TvEpisodeMediaRecord[]> {
        const episodes = await this.mediaManager.database.tables.episodes.find( query => 
            query.filter( doc => ( r as any ).and( customQuery( doc ), doc( 'watched' ).eq( r.expr( !watched ) ) ) )    
        );

        if ( watched ) {
            // When watched, only increment the play count of episodes whose play count equals zero
            await this.mediaManager.database.tables.episodes.updateMany(
                doc => ( r as any ).and( customQuery( doc ), doc( 'watched' ).eq( r.expr( false ) ) )
            , row => r.branch(
                row( 'playCount' ).eq( 0 ),
                { watched: true, lastPlayedAt: watchedAt, playCount: row( 'playCount' ).add( 1 ) } as any,
                { watched: true } as any
            ) );
        } else {
            await this.mediaManager.database.tables.episodes.updateMany(
                doc => ( r as any ).and( customQuery( doc ), doc( 'watched' ).eq( r.expr( true ) ) )
            , { watched: false } );
        }

        for ( let episode of episodes ) {
            // MARK UNAWAITED
            this.mediaManager.server.repositories.watch( episode, watched );
        }

        return episodes;
    }

    async watchTvShow ( show : TvShowMediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            // First, list all seasons belonging to this TV Show
            const seasons = await this.mediaManager.database.tables.seasons.find( query => query.filter( {
                tvShowId: show.id
            } ) );
    
            // Then compile all their ids
            const seasonIds = seasons.map( season => season.id );
    
            // And get all episodes that belong to those seasons and are or are not watched, depending on what change we are making
            const episodes = await this.watchTvEpisodesBatch( doc => r.expr( seasonIds ).contains( doc( 'tvSeasonId' ) ), watched, watchedAt );
                        
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

    async watchTvSeason ( season : TvSeasonMediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            const episodes = await this.watchTvEpisodesBatch( doc => doc( 'tvSeasonId' ).eq( r.expr( season.id ) ), watched, watchedAt );
    
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

    async watchTvEpisode ( episode : TvEpisodeMediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            episode = await this.mediaManager.database.tables.episodes.get( episode.id );

            if ( !watched && !episode.watched ) {
                return;
            }

            await this.mediaManager.database.tables.episodes.update( episode.id, watched 
                ? { watched: true, lastPlayedAt: watchedAt, playCount: r.row( 'playCount' ).add( 1 ) }
                : { watched: false } 
            );

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

    async watchMovie ( movie : MovieMediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            movie = await this.mediaManager.database.tables.movies.get( movie.id );

            if ( !watched && !movie.watched ) {
                return;
            }

            await this.mediaManager.database.tables.movies.update( movie.id, watched 
                ? { watched: true, lastPlayedAt: watchedAt, playCount: r.row( 'playCount' ).add( 1 ) }
                : { watched: false } 
            );

            // MARK UNAWAITED
            this.mediaManager.server.repositories.watch( movie, watched );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watchCustom ( custom : CustomMediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        const release = await this.semaphore.acquire();

        try {
            custom = await this.mediaManager.database.tables.custom.get( custom.id );

            if ( !watched && !custom.watched ) {
                return;
            }

            await this.mediaManager.database.tables.custom.update( custom.id, watched 
                ? { watched: true, lastPlayedAt: watchedAt, playCount: r.row( 'playCount' ).add( 1 ) }
                : { watched: false } 
            );
        } catch ( err ) {
            throw err;
        } finally {
            release();
        }
    }

    async watch ( media : MediaRecord, watched : boolean = true, watchedAt : Date = new Date() ) {
        if ( media.kind === MediaKind.Movie ) {
            return this.watchMovie( media as MovieMediaRecord, watched, watchedAt );
        } else if ( media.kind === MediaKind.TvShow ) {
            return this.watchTvShow( media as TvShowMediaRecord, watched, watchedAt );
        } else if ( media.kind === MediaKind.TvSeason ) {
            return this.watchTvSeason( media as TvSeasonMediaRecord, watched, watchedAt );
        } else if ( media.kind === MediaKind.TvEpisode ) {
            return this.watchTvEpisode( media as TvEpisodeMediaRecord, watched, watchedAt );
        } else if ( media.kind === MediaKind.Custom ) {
            return this.watchCustom( media as CustomMediaRecord, watched, watchedAt );
        }
    }
}

export interface Route extends restify.RouteOptions {
    method : string;
}

export class MultiServer extends EventEmitter {
    servers : restify.Server[] = [];

    routes : Route[] = [];

    constructor ( servers : restify.Server[] = [] ) {
        super();

        this.servers = servers;
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

    protected addRoute ( opts: string | RegExp | restify.RouteOptions, method : string = null ) {
        let route : restify.RouteOptions = null;

        if ( typeof opts === 'string' ) {
            route = { path: opts };
        } else if ( opts instanceof RegExp ) {
            route = { path: opts };
        } else {
            route = opts;
        }

        this.routes.push( {
            ...route,
            method: method || 'all' 
        } );
    }

    del ( opts: string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'del' );

        return this.servers.map( server => server.del( opts, ...handlers ) );
    }

    get ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'get' );

        return this.servers.map( server => server.get( opts, ...handlers ) );
    }

    head ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'head' );

        return this.servers.map( server => server.head( opts, ...handlers ) );
    }

    opts ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'opts' );

        return this.servers.map( server => server.opts( opts, ...handlers ) );
    }

    post ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'post' );

        return this.servers.map( server => server.post( opts, ...handlers ) );
    }

    put ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'put' );

        return this.servers.map( server => server.put( opts, ...handlers ) );
    }

    patch ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        this.addRoute( opts, 'patch' );

        return this.servers.map( server => server.patch( opts, ...handlers ) );
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