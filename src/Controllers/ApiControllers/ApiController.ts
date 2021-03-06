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
import * as sortBy from 'sort-by';
import { RepositoriesController } from './MediaControllers/RepositoriesController';

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

    @Controller( StorageController, '/storage' )
    storage : StorageController;

    @Route( 'get', '/ping' )
    ping () {
        return { alive: true, now: Date.now() };
    }

    @Route( 'get', '/speedtest', BinaryResponse )
    speedtest () {
        return { data: new RandomStream() };
    }

    @Route( 'get', '/sitemap' )
    async sitemap () {
        return Array.from( this.server.http.routes ).sort( sortBy( 'path' ) );
    }
    
    @Route( 'get', '/close' )
    async close () {
        await this.server.quit( 1000 );
    }
}