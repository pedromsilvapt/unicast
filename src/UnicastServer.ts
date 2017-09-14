import { ProvidersManager } from "./MediaProviders/ProvidersManager";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, MediaRecord, CustomMediaRecord, TvEpisodeMediaRecord, TvSeasonMediaRecord, TvShowMediaRecord } from "./MediaRecord";
import { Database, BaseTable, CategoryRecord } from "./Database";
import { MediaSourceDetails, MediaSource } from "./MediaProviders/MediaSource";
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

export class UnicastServer {
    readonly config : Config;

    readonly database : Database;

    readonly receivers : ReceiversManager;

    readonly providers : ProvidersManager;

    readonly media : MediaManager;

    readonly tasks : BackgroundTasksManager;

    readonly http : restify.Server;

    get repositories () : RepositoriesManager { return this.providers.repositories; }

    constructor () {
        this.config = Config.singleton();

        this.database = new Database( this.config );

        this.receivers = new ReceiversManager( this );

        this.providers = new ProvidersManager();

        this.media = new MediaManager( this );

        this.tasks = new BackgroundTasksManager();

        this.http = restify.createServer();

        this.http.name = Config.get<string>( 'name', 'unicast' );
    }

    getIpV4 () : Promise<string> {
        return internalIp.v4();
    }

    async getPort () : Promise<number> {
        return this.config.get( 'server.port' );
    }

    async getUrl ( path ?: string ) : Promise<string> {
        return `http://${ await this.getIpV4() }:${ await this.getPort() }` + ( path || '' );
    }

    async listen () : Promise<void> {
        const ip : string = await this.getIpV4();;

        const port : number = await this.getPort();;
    
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
                return req.method === 'OPTIONS' || !req.url.startsWith( '/api' );
            }
        } ) );

        // Attach all api controllers
        new ApiController( this, '/api' ).install();

        this.http.use( ( req, res, next ) => {
            if ( req.url.startsWith( '/api/' ) ) {
                next( new ResourceNotFoundError( `Could not find the resource "${ req.url }"` ) );
            }

            next();
        } );

        // Start the static server
        routes( await this.getUrl(), await this.getUrl( '/api' ) ).applyRoutes( this.http );

        await this.database.install();

        return new Promise<void>( ( resolve, reject ) => {
            this.http.listen( port, () => {
                console.log( this.http.name, 'listening on', this.http.url );

                resolve();
            } );
        } )
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

    async getCollections ( kind : MediaKind, id : string ) : Promise<CategoryRecord[]> {
        const categories = await this.database.tables.collectionsMedia.find( query => {
            return query.filter( doc => doc( 'mediaKind' ).eq( kind ).and( doc( 'mediaId' ).eq( id ) ) );
        } );

        const ids = categories.map( r => r.collectionId );

        return this.server.database.tables.collections.findAll( ids );
    }
}