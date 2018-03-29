import { BaseKodiRepository, KodiRecordTransformer, RecordTransformer, RecordTransformerSchema } from "./BaseKodiRepository";
import { IMovieMediaRepository, MediaQuery } from "../BaseRepository/IMediaRepository";
import { MovieMediaRecord, MediaKind } from "../../MediaRecord";
import * as replaceExt        from 'replace-ext';
import { KodiApi } from "./KodiApi";
import { IMediaProvider } from "../../MediaProviders/BaseMediaProvider/IMediaProvider";
import { SubtitlesKodiRepository } from "./SubtitlesKodiRepository";

export class MovieKodiRepository extends BaseKodiRepository<MovieMediaRecord> implements IMovieMediaRepository {
    internalKind = 'movie';

    kind : MediaKind = MediaKind.Movie;

    transformer : MovieRecordTransformer;

    constructor ( provider : IMediaProvider, kodi : KodiApi, subtitles ?: SubtitlesKodiRepository ) {
        super( provider, kodi, subtitles );

        this.transformer = new MovieRecordTransformer( this.name );
    }

    async fetch ( id : string, query : MediaQuery = {} ) : Promise<MovieMediaRecord> {
        const movie = await this.kodi.getSingleMovie( this.createParams( {
            ...query,
            id: id
        } ) );

        return this.transformer.doObject( movie );
    }

    fetchMany ( ids : string[], query : MediaQuery = {} ) : Promise<MovieMediaRecord[]> {
        return Promise.all( ids.map( id => this.fetch( id, query ) ) );
    }

    async find ( query : MediaQuery = {} ) : Promise<MovieMediaRecord[]> {
        const movies = await this.kodi.getMovies( this.createParams( query ) );

        return this.transformer.doArray( movies );
    }

    async watch ( id : string, status : boolean ) : Promise<MovieMediaRecord> {
        await this.kodi.setSingleMovie( +id, { playcount: status ? 1 : 0 } );

        return this.fetch( id );
    }
}

export class MovieRecordTransformer extends KodiRecordTransformer {
    constructor ( repositoryName : string, schema : RecordTransformerSchema = {}, parent : RecordTransformer = null ) {
        super( {
            internalId : 'movieid',
            repository : () => repositoryName,
            kind: () => MediaKind.Movie,
            title : 'title',
            genres : obj => obj.genre,
            art: obj => ( {
                thumbnail: this.decodeImagePath( obj.art[ 'thumb' ] ),
                poster: this.decodeImagePath( obj.art[ 'poster' ] ),
                background: this.decodeImagePath( obj.art[ 'fanart' ] ),
                banner: this.decodeImagePath( obj.art[ 'banner' ] )
            } ),
            external : obj => ( { imdb: obj.imdbnumber } ),
            runtime : 'runtime',
            sources : obj => [
                { id: `kodi://${ repositoryName }/movie/${ obj.movieid }` },
                { id: obj.file },
                { id: replaceExt( obj.file, '.srt' ) }
            ],
            quality : obj => this.parseQuality( obj.file ),
            playCount : 'playcount',
            watched : obj => obj.playcount > 0,
            lastPlayed : obj => obj.lastplayed ? new Date( obj.lastplayed ) : null,
            addedAt : obj => obj.dateadded ? new Date( obj.dateadded ) : null,
            rating : 'rating',
            trailer : obj => this.decodeTrailerUrl( obj.trailer ),
            parentalRating : 'mpaa',
            plot : 'plot',
            year : 'year',
            tagline : 'tagline',
            ...schema
        }, parent );
    }
}
