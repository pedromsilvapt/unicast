import { BaseController, RoutesDeclarations, Controller, Route } from "../BaseController";
import { MoviesController } from "./MediaControllers/MoviesController";
import { TvShowsController } from "./MediaControllers/TvShowsController";
import { PlayerController } from "./PlayerController";
import { TvSeasonsController } from "./MediaControllers/TvSeasonsController";
import { TvEpisodesController } from "./MediaControllers/TvEpisodesController";
import { CollectionsController } from "./MediaControllers/CollectionsController";
import { ArtworkController } from "./MediaControllers/ArtworkController";
import { ProvidersController } from "./MediaControllers/ProvidersController";
import { TasksController } from "./TasksController";
import { SubtitlesController } from "./MediaControllers/SubtitlesController";

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

    @Controller( CollectionsController, '/media/collection' )
    collections : CollectionsController;

    @Controller( ArtworkController, '/media/artwork' )
    artwork : ArtworkController;

    @Controller( SubtitlesController, '/media/subtitles' )
    subtitles : SubtitlesController;

    @Controller( ProvidersController, '/media/providers' )
    providers : ProvidersController;

    @Route( 'get', '/close' )
    async close () {
        await this.server.quit( 1000 );
    }
}