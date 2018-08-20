import { BaseKodiRepository, KodiRecordTransformer, RecordTransformer, RecordTransformerSchema } from "./BaseKodiRepository";
import { ITvShowMediaRepository, MediaQuery } from "../BaseRepository/IMediaRepository";
import { TvShowMediaRecord, MediaKind } from "../../MediaRecord";
import { KodiApi } from "./KodiApi";

export class TvShowKodiRepository extends BaseKodiRepository<TvShowMediaRecord> implements ITvShowMediaRepository {
    internalKind = 'tvshow';

    kind : MediaKind = MediaKind.TvShow;

    transformer : TvShowRecordTransformer;

    constructor ( name : string, kodi : KodiApi ) {
        super( name, kodi );

        this.transformer = new TvShowRecordTransformer( this.name );
    }

    async fetch ( id : string, query : MediaQuery = {} ) : Promise<TvShowMediaRecord> {
        const show = await this.kodi.getSingleShow( this.createParams( {
            ...query,
            id: id
        } ) );

        return this.transformer.doObject( show );
    }

    fetchMany ( ids : string[], query : MediaQuery = {} ) : Promise<TvShowMediaRecord[]> {
        return Promise.all( ids.map( id => this.fetch( id, query ) ) );
    }

    async find ( query : MediaQuery = {} ) : Promise<TvShowMediaRecord[]> {
        const shows = await this.kodi.getShows( this.createParams( query ) );

        return this.transformer.doArray( shows );
    }
}

export class TvShowRecordTransformer extends KodiRecordTransformer {
    constructor ( repositoryName, schema : RecordTransformerSchema = {}, parent : RecordTransformer = null ) {
        super( {
            internalId : 'tvshowid',
            kind: () => MediaKind.TvShow,
            repository: () => repositoryName,
            title : 'title',
            genres : obj => obj.genre,
            art: obj => ( {
                thumbnail: this.decodeImagePath( obj.art[ 'thumb' ] ),
                poster: this.decodeImagePath( obj.art[ 'poster' ] ),
                background: this.decodeImagePath( obj.art[ 'fanart' ] ),
                banner: this.decodeImagePath( obj.art[ 'banner' ] )
            } ),
            external : obj => ( { imdb: obj.imdbnumber } ),
            // sources : obj => [
            //     { id: `kodi://movie/${ obj.movieid }` },
            //     { id: obj.file },
            //     { id: replaceExt( obj.file, '.srt' ) }
            // ],
            playCount : 'playcount',
            watched : obj => obj.watchedepisodes >= obj.episode,
            lastPlayed : obj => obj.lastplayed ? new Date( obj.lastplayed ) : null,
            addedAt : obj => obj.dateadded ? new Date( obj.dateadded ) : null,
            rating : 'rating',
            year : 'year',
            episodesCount : 'episode',
            seasonsCount : 'season',
            watchedEpisodesCount : 'watchedepisodes',
            parentalRating : 'mpaa',
            plot : 'plot',
            ...schema
        }, parent );
    }

    protected decodeImagePath ( image : string ) {
        if ( typeof image !== 'string' ) {
            return null;
        }

        if ( image.startsWith( 'image://' ) ) {
            image = image.slice( 8, -1 );
        }

        return decodeURIComponent( image );
    }
}
