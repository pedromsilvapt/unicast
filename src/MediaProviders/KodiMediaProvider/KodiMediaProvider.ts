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
import { SubtitlesKodiRepository, ILocalKodiSubtitle } from "../../MediaRepositories/KodiRepositories/SubtitlesKodiRepository";

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

        this.moviesRepository = new MovieKodiRepository( this, this.api, this.subtitlesRepository );
        this.tvShowsKodiRepository = new TvShowKodiRepository( this, this.api );
        this.tvSeasonsKodiRepository = new TvSeasonKodiRepository( this, this.api );
        this.tvEpisodesKodiRepository = new TvEpisodeKodiRepository( this, this.api, this.subtitlesRepository );
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

// ( async function main () {
//     const api = new KodiApi();

//     const movies = await api.getMovies( {} );

//     // console.log( movies.length, Object.keys( movies[ 0 ] ) );
//     movies.filter( movie => movie.file.startsWith( 'L:' ) && movie.playcount === 0 ).forEach( movie => console.log( movie.file ) );

//     console.log( movies.filter( movie => movie.file.startsWith( 'L:' ) && movie.playcount === 0 ).length );
// } )().catch( err => console.error( err ) );