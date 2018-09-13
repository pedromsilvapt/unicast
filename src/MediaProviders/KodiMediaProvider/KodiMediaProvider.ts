import { BaseMediaProvider } from "../BaseMediaProvider/BaseProvider";
import { ProvidersManager } from "../ProvidersManager";
import { MediaSourceDetails } from "../MediaSource";
import { KodiMediaSource } from "./KodiMediaSource";
// TODO delete this and update the kodi repository for the new repositories API
// import { MovieKodiRepository } from "../../MediaRepositoriesLegacy/KodiRepositories/MovieKodiRepository";
// import { TvShowKodiRepository } from "../../MediaRepositoriesLegacy/KodiRepositories/TvShowsKodiRepository";
// import { KodiApi } from "../../MediaRepositoriesLegacy/KodiRepositories/KodiApi";
// import { TvSeasonKodiRepository } from "../../MediaRepositoriesLegacy/KodiRepositories/TvSeasonKodiRepository";
// import { TvEpisodeKodiRepository } from "../../MediaRepositoriesLegacy/KodiRepositories/TvEpisodeKodiRepository";
// import { SubtitlesKodiRepository } from "../../MediaRepositoriesLegacy/KodiRepositories/SubtitlesKodiRepository";

export class KodiMediaProvider extends BaseMediaProvider {
    readonly type : string = 'kodi';

    // api : KodiApi;

    // moviesRepository : MovieKodiRepository;

    // tvShowsKodiRepository : TvShowKodiRepository;

    // tvSeasonsKodiRepository : TvSeasonKodiRepository;

    // tvEpisodesKodiRepository : TvEpisodeKodiRepository;

    // subtitlesRepository : SubtitlesKodiRepository;

    constructor ( name : string, address : string, port : number ) {
        super( name );

        // this.api = new KodiApi( address, port );
    }

    onEntityInit () {
        // this.subtitlesRepository = new SubtitlesKodiRepository( this.server );

        // this.moviesRepository = new MovieKodiRepository( this.name, this.api, this.subtitlesRepository );
        // this.tvShowsKodiRepository = new TvShowKodiRepository( this.name, this.api );
        // this.tvSeasonsKodiRepository = new TvSeasonKodiRepository( this.name, this.api );
        // this.tvEpisodesKodiRepository = new TvEpisodeKodiRepository( this.name, this.api, this.subtitlesRepository );
    }

    match ( source : string ) : boolean {
        return source.startsWith( `kodi://${ this.name }` ) || source.startsWith( `xmbc://${ this.name }` );
    }

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : KodiMediaSource {
        return new KodiMediaSource( manager, this, source );
    }
}
