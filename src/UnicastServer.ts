import { ProvidersManager } from "./MediaProviders/ProvidersManager";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, MediaRecord, CustomMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from "./MediaRecord";
import { Database, BaseTable, CollectionRecord } from "./Database";
import { MediaSourceDetails } from "./MediaProviders/MediaSource";
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

export class UnicastServer {
    readonly hooks : Hookable = new Hookable();

    readonly onStart : Hook<void> = this.hooks.create( 'start' );

    readonly onListen : Hook<void> = this.hooks.create( 'listen' );
    
    readonly onError : Hook<Error> = this.hooks.create( 'error' );

    readonly onClose : Hook<void> = this.hooks.create( 'close' );

    readonly config : Config;

    readonly database : Database;

    readonly receivers : ReceiversManager;

    readonly providers : ProvidersManager;

    readonly media : MediaManager;

    readonly tasks : BackgroundTasksManager;

    readonly storage : Storage;

    readonly subtitles : SubtitlesManager;

    readonly artwork : ArtworkCache;

    readonly triggerdb : TriggerDb;

    readonly transcoding : TranscodingManager;

    readonly diagnostics : Diagnostics;

    readonly http : MultiServer;

    get repositories () : RepositoriesManager { return this.providers.repositories; }

    protected cachedIpV4 : string;

    isHttpsEnabled : boolean = false;

    constructor () {
        this.config = Config.singleton();

        this.database = new Database( this.config );

        this.receivers = new ReceiversManager( this );

        this.providers = new ProvidersManager( this );

        this.media = new MediaManager( this );

        this.tasks = new BackgroundTasksManager();

        this.storage = new Storage( this );

        this.subtitles = new SubtitlesManager( this );

        this.artwork = new ArtworkCache( this );

        this.triggerdb = new TriggerDb( this );
        
        this.transcoding = new TranscodingManager( this );

        this.diagnostics = new Diagnostics( this );

        this.http = new MultiServer( [ restify.createServer() ] );

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

    async getIpV4 () : Promise<string> {
        if ( this.cachedIpV4 ) {
            return this.cachedIpV4;
        }

        return this.cachedIpV4 = await internalIp.v4();
    }

    async getPort () : Promise<number> {
        return this.config.get( 'server.port' );
    }

    async getSecurePort () : Promise<number> {
        return this.config.get( 'server.ssl.port' );
    }

    async getUrl ( path ?: string ) : Promise<string> {
        return `http://${ await this.getIpV4() }:${ await this.getPort() }` + ( path || '' );
    }

    async getSecureUrl ( path ?: string ) : Promise<string> {
        return `https://${ await this.getIpV4() }:${ await this.getSecurePort() }` + ( path || '' );
    }

    async getMatchingUrl ( req : restify.Request, path ?: string ) : Promise<string> {
        if ( ( req.connection as any ).encrypted ) {
            return this.getSecureUrl( path );
        } else {
            return this.getUrl( path );
        }
    }

    async listen () : Promise<void> {
        await this.onStart.notify();

        await this.getIpV4();

        const port : number = await this.getPort();

        const sslPort : number = await this.getSecurePort();
    
        // Attach all api controllers
        new ApiController( this, '/api' ).install();

        this.http.use( ( req, _res, next ) => {
            if ( req.url.startsWith( '/api/' ) ) {
                next( new ResourceNotFoundError( `Could not find the resource "${ req.url }"` ) );
            }

            next();
        } );

        // Start the static server
        routes( await this.getUrl(), await this.getUrl( '/api' ) ).applyRoutes( this.http.servers[ 0 ] );

        if ( this.http.servers.length > 1 ) {
            routes( await this.getSecureUrl(), await this.getSecureUrl( '/api' ) ).applyRoutes( this.http.servers[ 1 ] );
        }

        await this.database.install();

        await this.onListen.notify();

        await this.http.listen( [ port, sslPort ] );

        await this.storage.clean();

        this.diagnostics.info( 'unicast', this.http.name + ' listening on ' + await this.getUrl() );
        
        if ( this.isHttpsEnabled ) {
            this.diagnostics.info( 'unicast', this.http.name + ' listening on ' + await this.getSecureUrl() );
        }
    }

    async close () {
        await this.onClose.notify();

        this.http.close();
    }

    async quit ( delay : number = 0 ) {
        try {
            await this.close();
        } finally {
            if ( delay > 0 ) {
                setTimeout( () => process.exit(), delay );
            } else {
                process.exit();
            }
        }
    }
}


export class MediaManager {
    readonly server  : UnicastServer;

    get database () : Database {
        return this.server.database;
    }

    get providers () : ProvidersManager {
        return this.server.providers;
    }

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    getTable ( kind : MediaKind ) : BaseTable<MediaRecord> {
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
    get ( kind : MediaKind, id : string ) : Promise<MediaRecord>;
    get ( kind : MediaKind, id : string ) : Promise<MediaRecord> {
        let table : BaseTable<MediaRecord> = this.getTable( kind );

        return table.get( id );
    }

    store ( record : MediaRecord ) : Promise<MediaRecord> {
        let table : BaseTable<MediaRecord> = this.getTable( record.kind );

        return table.create( record );
    }

    async createFromSources ( sources : MediaSourceDetails[] ) : Promise<MediaRecord> {
        let normalized = this.server.providers.normalizeSources( sources );

        let media = await this.server.providers.getMediaRecordFor( normalized );

        if ( media.id ) {
            let table = this.getTable( media.kind );

            const existingMedia = await table.get( media.id );

            if ( existingMedia ) {
                return existingMedia;
            }

            delete media.id;

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
}

export class MultiServer extends EventEmitter {
    servers : restify.Server[] = [];

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

    del ( opts: string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.del( opts, ...handlers ) );
    }

    get ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.get( opts, ...handlers ) );
    }

    head ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.head( opts, ...handlers ) );
    }

    opts ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.opts( opts, ...handlers ) );
    }

    post ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.post( opts, ...handlers ) );
    }

    put ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
        return this.servers.map( server => server.put( opts, ...handlers ) );
    }

    patch ( opts : string | RegExp | restify.RouteOptions, ...handlers : restify.RequestHandlerType[] ) : Array<boolean | restify.Route> {
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