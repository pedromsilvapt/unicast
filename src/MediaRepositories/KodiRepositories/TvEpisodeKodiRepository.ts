import { BaseKodiRepository, KodiRecordTransformer, RecordTransformer, RecordTransformerSchema } from "./BaseKodiRepository";
import { ITvEpisodeMediaRepository, MediaQuery, TvEpisodeMediaQuery } from "../BaseRepository/IMediaRepository";
import { TvEpisodeMediaRecord, MediaKind } from "../../MediaRecord";
import * as replaceExt        from 'replace-ext';
import { KodiApi } from "./KodiApi";
import { SubtitlesKodiRepository } from "./SubtitlesKodiRepository";

export class TvEpisodeKodiRepository extends BaseKodiRepository<TvEpisodeMediaRecord> implements ITvEpisodeMediaRepository {
    internalKind = 'episode';

    kind : MediaKind = MediaKind.TvEpisode;

    transformer : TvEpisodeRecordTransformer;
    
    constructor ( name : string, kodi : KodiApi, subtitles ?: SubtitlesKodiRepository ) {
        super( name, kodi, subtitles );

        this.transformer = new TvEpisodeRecordTransformer( this.name );
    }

    createParams ( query : TvEpisodeMediaQuery = {} ) : any {
        const params : any = super.createParams( query );

        if ( query.show ) {
            params.tvshowid = query.show;

            if ( query.season ) {
                params.season = query.season;
            }
        }

        return params;
    }

    async fetch ( id : string, query : TvEpisodeMediaQuery = {} ) : Promise<TvEpisodeMediaRecord> {
        const episode = await this.kodi.getSingleEpisode( this.createParams( {
            ...query,
            id: id
        } ) );

        return this.transformer.doObject( episode );
    }

    fetchMany ( ids : string[], query : TvEpisodeMediaQuery = {} ) : Promise<TvEpisodeMediaRecord[]> {
        return Promise.all( ids.map( id => this.fetch( id, query ) ) );
    }

    async find ( query : TvEpisodeMediaQuery = {} ) : Promise<TvEpisodeMediaRecord[]> {
        const episodes = await this.kodi.getEpisodes( this.createParams( query ) );

        return this.transformer.doArray( episodes );
    }

    async watch ( id : string, status : boolean ) : Promise<TvEpisodeMediaRecord> {
        await this.kodi.setSingleEpisode( +id, { playcount: status ? 1 : 0 } );

        return this.fetch( id );
    }
}

export class TvEpisodeRecordTransformer extends KodiRecordTransformer {
    constructor ( repositoryName : string, schema : RecordTransformerSchema = {}, parent : RecordTransformer = null ) {
        super( {
            internalId : 'episodeid',
            kind: () => MediaKind.TvEpisode,
            repository: () => repositoryName,
            title: 'title',
            plot: 'plot',
            rating: 'rating',
            runtime: 'runtime',
            number : 'episode',
            seasonNumber : 'season',
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
            sources : obj => [
                { id: `kodi://${ repositoryName }/episode/${ obj.episodeid }` },
                { id: obj.file },
                { id: replaceExt( obj.file, '.srt' ) }
            ],
            quality : obj => this.parseQuality( obj.file ),
            playCount: 'playcount',
            watched: obj => obj.playcount > 0,
            addedAt: obj => new Date( obj.dateadded ),
            lastPlayed: obj => obj.lastplayed ? new Date( obj.lastplayed ) : null,
            airedAt: obj => new Date( obj.firstaired ),
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
