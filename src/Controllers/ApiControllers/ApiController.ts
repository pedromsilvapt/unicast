import { BaseController, Controller, Route, BinaryResponse } from "../BaseController";
import { MoviesController } from "./MediaControllers/MoviesController";
import { TvShowsController } from "./MediaControllers/TvShowsController";
import { PlayerController } from "./PlayerController";
import { TvSeasonsController } from "./MediaControllers/TvSeasonsController";
import { TvEpisodesController } from "./MediaControllers/TvEpisodesController";
import { CustomController } from './MediaControllers/CustomController';
import { CollectionsController } from "./MediaControllers/CollectionsController";
import { ArtworkController } from "./MediaControllers/ArtworkController";
import { ProvidersController } from "./MediaControllers/ProvidersController";
import { TasksController } from "./TasksController";
import { SubtitlesController } from "./MediaControllers/SubtitlesController";
import { SessionsController } from "./MediaControllers/SessionsController";
import { ScrapersController } from "./MediaControllers/ScrapersController";
import { PeopleController } from './MediaControllers/PeopleController';
import { StorageController } from './MediaControllers/StorageController';
import { RandomStream } from '../../ES2017/RandomStream';
import { RepositoriesController } from './MediaControllers/RepositoriesController';
import { CustomActionsController } from './CustomActionsController';
import { UserRanksController } from './UserRanksController';
import * as sortBy from 'sort-by';
import * as schema from '@gallant/schema';
import { Request, Response } from "restify";

export class ApiController extends BaseController {
    @Controller( TasksController, '/tasks' )
    tasks : TasksController;

    @Controller( PlayerController, '/player' )
    player : PlayerController;

    @Controller( MoviesController, '/media/movie' )
    movies : MoviesController;

    @Controller( TvShowsController, '/media/show' )
    shows : TvShowsController;

    @Controller( TvSeasonsController, '/media/season' )
    seasons : TvSeasonsController;

    @Controller( TvEpisodesController, '/media/episode' )
    episodes : TvEpisodesController;

    @Controller( CustomController, '/media/custom' )
    custom : CustomController;

    @Controller( PeopleController, '/media/people' )
    people : PeopleController;

    @Controller( CollectionsController, '/media/collection' )
    collections : CollectionsController;

    @Controller( ArtworkController, '/media/artwork' )
    artwork : ArtworkController;

    @Controller( SubtitlesController, '/media/subtitles' )
    subtitles : SubtitlesController;

    @Controller( ProvidersController, '/media/providers' )
    providers : ProvidersController;

    @Controller( RepositoriesController, '/media/repositories' )
    repositories : RepositoriesController;

    @Controller( SessionsController, '/media/sessions' )
    sessions : SessionsController;

    @Controller( ScrapersController, '/media/scrapers' )
    scrapers : ScrapersController;

    @Controller( UserRanksController, '/media/user-ranks' )
    userRanks : UserRanksController;

    @Controller( StorageController, '/storage' )
    storage : StorageController;

    @Controller( CustomActionsController, '/custom-actions' )
    customActionsController : CustomActionsController;

    @Route( 'get', '/ping' )
    ping ( req: Request ) {
        return { alive: true, now: Date.now(), identity: req.identity };
    }

    @Route( 'get', '/speedtest', BinaryResponse )
    speedtest () {
        return { data: new RandomStream() };
    }

    @Route( 'post', '/execute-tool/:name' )
    async executeTool ( req: Request, res: Response ) {
        await this.server.tools.run( req.params.name, req.body.options );

        return { success: true };
    }

    @Route( 'get', '/sitemap' )
    async sitemap () {
        return Array.from( this.server.http.routes )
            .map( route => {
                const jsonRoute: any = {
                    method: route.method,
                    path: route.path,
                };

                if ( route.querySchema != null ) {
                    jsonRoute.querySchema = schema.stringify( route.querySchema, schema.createDefaultOptions( {
                        defaultNumberStrict: false,
                        defaultObjectStrict: false,
                    } ) );
                }

                if ( route.bodySchema != null ) {
                    jsonRoute.bodySchema = schema.stringify( route.bodySchema, schema.createDefaultOptions( {
                        defaultNumberStrict: false,
                        defaultObjectStrict: false,
                    } ) );
                }

                if ( route.description != null ) {
                    jsonRoute.description = route.description;
                }

                return jsonRoute;
            } )
            .sort( sortBy( 'path' ) );
    }

    @Route( 'get', '/close' )
    async close () {
        await this.server.quit( 1000 );
    }
}
