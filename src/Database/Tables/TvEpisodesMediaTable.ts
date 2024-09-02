import { DatabaseTables } from '../Database';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { BelongsToOneRelation } from '../Relations/OneToOneRelation';
import { MediaKind, AbstractMediaTable, PlayableMediaRecord, PlayableMediaRecordSql, MediaTableForeignKeys } from './AbstractMediaTable';
import type { TvSeasonMediaRecord, TvSeasonMediaRecordArt } from './TvSeasonsMediaTable';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import { Converters, FieldConverters } from '../Converters';

export class TvEpisodesMediaTable extends AbstractMediaTable<TvEpisodeMediaRecord> {
    readonly tableName : string = 'mediaTvEpisodes';

    readonly kind : MediaKind = MediaKind.TvEpisode;

    dateFields = [ 'addedAt', 'airedAt', 'lastPlayedAt' ];

    baseline : Partial<TvEpisodeMediaRecord> = {
        watched: false,
        lastPlayedAt: null,
        playCount: 0,
        transient: false
    };

    fieldConverters: FieldConverters<TvEpisodeMediaRecord, TvEpisodeMediaRecordSql> = {
        id: Converters.id(),
        sources: Converters.json(),
        quality: Converters.json(),
        external: Converters.json(),
        art: Converters.json(),
        repositoryPaths: Converters.json(),
        watched: Converters.bool(),
        transient: Converters.bool(),
        addedAt: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
        tvSeasonId: Converters.id(),
        airedAt: Converters.date(),
        lastPlayedAt: Converters.date(),
        lastPlayedAtLegacy: Converters.json()
    };

    foreignMediaKeys : MediaTableForeignKeys = {
        tvSeasonId: MediaKind.TvSeason
    }

    declare relations : {
        season: BelongsToOneRelation<TvEpisodeMediaRecord, TvSeasonMediaRecord>,
        collections: ManyToManyRelation<TvEpisodeMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvEpisodeMediaRecord, PersonRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            season: new BelongsToOneRelation( 'tvSeason', tables.seasons, 'tvSeasonId' ),
        };
    }

    async repairTvShowArt ( episode : string | TvEpisodeMediaRecord ) : Promise<Partial<TvEpisodeMediaRecord>> {
        if ( typeof episode === 'string' ) {
            episode = await this.get( episode );
        }

        const season = await this.database.tables.seasons.get( episode.tvSeasonId );

        if ( !season ) {
            return episode;
        }

        const show = await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return {};
        }

        return {
            art: {
                ...episode.art,
                tvshow: show.art
            }
        };
    }

    async repair ( episodes : string[] = null ) {
        if ( !episodes ) {
            episodes = ( await this.find() ).map( episode => episode.id );
        }

        await super.repair( episodes );

        const episodeRecords = await this.findAll( episodes );
        
        await Promise.all( episodeRecords.map( async episode => {
            const changes = {
                ...await this.repairTvShowArt( episode ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( episode ),
            }

            await this.updateIfChanged( episode, changes );

            Object.assign( episode, changes );
        } ) );
    }
}

export interface TvEpisodeMediaRecord extends PlayableMediaRecord {
    art: TvSeasonMediaRecordArt,
    kind : MediaKind.TvEpisode;
    number : number;
    seasonNumber : number;   
    tvSeasonId : string;
    tvSeasonKind : MediaKind.TvSeason;
    rating : number;
    plot : string;
    airedAt : Date;
}
export interface TvEpisodeMediaRecordSql extends PlayableMediaRecordSql {
    tvSeasonId : number;
    airedAt: number;
}
