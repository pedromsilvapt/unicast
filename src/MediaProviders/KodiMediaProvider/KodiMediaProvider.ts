import { BaseMediaProvider } from "../BaseMediaProvider/BaseProvider";
import { IMediaRepository } from "../../MediaRepositories/BaseRepository/IMediaRepository";
import { ProvidersManager } from "../ProvidersManager";
import { MediaSourceDetails } from "../MediaSource";
import { KodiMediaSource } from "./KodiMediaSource";
import { MovieKodiRepository } from "../../MediaRepositories/KodiRepositories/MovieKodiRepository";
import { TvShowKodiRepository } from "../../MediaRepositories/KodiRepositories/TvShowsKodiRepository";
import { KodiApi } from "../../MediaRepositories/KodiRepositories/KodiApi";
import { TvSeasonKodiRepository } from "../../MediaRepositories/KodiRepositories/TvSeasonKodiRepository";
import { TvEpisodeKodiRepository } from "../../MediaRepositories/KodiRepositories/TvEpisodeKodiRepository";
import { SubtitlesKodiRepository } from "../../MediaRepositories/KodiRepositories/SubtitlesKodiRepository";

export class KodiMediaProvider extends BaseMediaProvider {
    readonly type : string = 'kodi';

    api : KodiApi;

    moviesRepository : MovieKodiRepository;

    tvShowsKodiRepository : TvShowKodiRepository;

    tvSeasonsKodiRepository : TvSeasonKodiRepository;

    tvEpisodesKodiRepository : TvEpisodeKodiRepository;

    subtitlesRepository : SubtitlesKodiRepository;

    constructor ( name : string, address : string, port : number ) {
        super( name );

        this.api = new KodiApi( address, port );
    }

    onEntityInit () {
        this.subtitlesRepository = new SubtitlesKodiRepository( this.server );

        this.moviesRepository = new MovieKodiRepository( this.name, this.api, this.subtitlesRepository );
        this.tvShowsKodiRepository = new TvShowKodiRepository( this.name, this.api );
        this.tvSeasonsKodiRepository = new TvSeasonKodiRepository( this.name, this.api );
        this.tvEpisodesKodiRepository = new TvEpisodeKodiRepository( this.name, this.api, this.subtitlesRepository );
    }

    getMediaRepositories () : IMediaRepository[] {
        return [
            this.moviesRepository,
            this.tvShowsKodiRepository,
            this.tvSeasonsKodiRepository,
            this.tvEpisodesKodiRepository
        ];
    }

    match ( source : string ) : boolean {
        return source.startsWith( `kodi://${ this.name }` ) || source.startsWith( `xmbc://${ this.name }` );
    }

    make ( manager : ProvidersManager, source : MediaSourceDetails ) : KodiMediaSource {
        return new KodiMediaSource( manager, this, source );
    }
}
