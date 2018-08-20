import { BaseKodiRepository, KodiRecordTransformer, RecordTransformer, RecordTransformerSchema } from "./BaseKodiRepository";
import { ITvSeasonMediaRepository, MediaQuery, TvSeasonMediaQuery } from "../BaseRepository/IMediaRepository";
import { TvSeasonMediaRecord, MediaKind } from "../../MediaRecord";
import { KodiApi } from "./KodiApi";

export class TvSeasonKodiRepository extends BaseKodiRepository<TvSeasonMediaRecord> implements ITvSeasonMediaRepository {
    internalKind = 'season';

    kind : MediaKind = MediaKind.TvSeason;

    transformer : TvSeasonRecordTransformer;
    
    constructor ( name : string, kodi : KodiApi ) {
        super( name, kodi );

        this.transformer = new TvSeasonRecordTransformer( this.name );
    }

    createParams ( query : TvSeasonMediaQuery = {} ) : any {
        const params : any = super.createParams( query );

        if ( query.show ) {
            params.tvshowid = query.show;
        }

        return params;
    }

    async fetch ( id : string, query : TvSeasonMediaQuery = {} ) : Promise<TvSeasonMediaRecord> {
        const season = await this.kodi.getSingleSeason( this.createParams( {
            ...query,
            id: id
        } ) );

        return this.transformer.doObject( season );
    }

    fetchMany ( ids : string[], query : TvSeasonMediaQuery = {} ) : Promise<TvSeasonMediaRecord[]> {
        return Promise.all( ids.map( id => this.fetch( id, query ) ) );
    }

    async find ( query : TvSeasonMediaQuery = {} ) : Promise<TvSeasonMediaRecord[]> {
        const seasons = await this.kodi.getSeasons( this.createParams( query ) );

        return this.transformer.doArray( seasons );
    }
}

export class TvSeasonRecordTransformer extends KodiRecordTransformer {
    constructor ( repositoryName : string, schema : RecordTransformerSchema = {}, parent : RecordTransformer = null ) {
        super( {
            internalId : 'seasonid',
            kind: () => MediaKind.TvSeason,
            repository: () => repositoryName,
            art: obj => ( {
                thumbnail: this.decodeImagePath( obj.art[ 'thumb' ] ),
                poster: this.decodeImagePath( obj.art[ 'poster' ] ),
                background: this.decodeImagePath( obj.art[ 'fanart' ] ),
                banner: this.decodeImagePath( obj.art[ 'banner' ] ),
                tvshow: {
                    thumbnail: this.decodeImagePath( obj.art[ 'tvshow.thumb' ] ),
                    poster: this.decodeImagePath( obj.art[ 'tvshow.poster' ] ),
                    background: this.decodeImagePath( obj.art[ 'tvshow.fanart' ] ),
                    banner: this.decodeImagePath( obj.art[ 'tvshow.banner' ] )
                }
            } ),
            number : 'season',
            tvShowInternalId : 'tvshowid',
            episodesCount : 'episode',
            watchedEpisodesCount : obj => obj.watchedepisodes || 0,
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
