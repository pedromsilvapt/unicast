import { DatabaseTables } from '../Database';
import { MediaKind, MediaRecord, MediaRecordArt, MediaRecordSql, AbstractMediaTable, MediaTableForeignKeys } from './AbstractMediaTable';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import type { TvShowMediaRecord } from './TvShowsMediaTable';
import type { TvEpisodeMediaRecord } from './TvEpisodesMediaTable';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { BelongsToOneRelation, HasOneRelation } from '../Relations/OneToOneRelation';
import { HasManyRelation } from '../Relations/OneToManyRelation';
import * as itt from 'itt';
import { Converters, FieldConverters } from '../Converters';
import { MediaProbeRecord } from './MediaProbesTable';

export class TvSeasonsMediaTable extends AbstractMediaTable<TvSeasonMediaRecord> {
    readonly tableName : string = 'mediaTvSeasons';

    readonly kind : MediaKind = MediaKind.TvSeason;

    baseline : Partial<TvSeasonMediaRecord> = {
        watchedEpisodesCount: 0,
        episodesCount: 0,
        transient: false
    };

    foreignMediaKeys : MediaTableForeignKeys = {
        tvShowId: MediaKind.TvShow
    }

    fieldConverters: FieldConverters<TvSeasonMediaRecord, TvSeasonMediaRecordSql> = {
        id: Converters.id(),
        external: Converters.json(),
        art: Converters.json(),
        repositoryPaths: Converters.json(),
        transient: Converters.bool(),
        tvShowId: Converters.id(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
        lastPlayedAt: Converters.date(),
        lastPlayedAtLegacy: Converters.json()
    };

    declare relations : {
        collections: ManyToManyRelation<TvSeasonMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvSeasonMediaRecord, PersonRecord>,
        probe: HasOneRelation<TvSeasonMediaRecord, MediaProbeRecord>,
        show: BelongsToOneRelation<TvSeasonMediaRecord, TvShowMediaRecord>,
        episodes: HasManyRelation<TvSeasonMediaRecord, TvEpisodeMediaRecord>,
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            show: new BelongsToOneRelation( 'tvShow', tables.shows, 'tvShowId' ),
            episodes: new HasManyRelation( 'episodes', tables.episodes, 'tvSeasonId' ).orderBy( 'number' ),
        };
    }

    async repairEpisodesCount ( season : string | TvSeasonMediaRecord, episodes : TvEpisodeMediaRecord[] | null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        episodes = episodes ?? await this.relations.episodes.load( season );

        const episodesCount : number = itt( episodes ).keyBy( episode => episode.number ).size;

        const watchedEpisodesCount : number = itt( episodes ).filter( episode => episode.watched ).keyBy( episode => episode.number ).size;

        return {
            episodesCount,
            watchedEpisodesCount
        };
    }

    async repairTvShowArt ( season : string | TvSeasonMediaRecord, show : TvShowMediaRecord | null = null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        show = show ?? await this.database.tables.shows.get( season.tvShowId );

        if ( !show ) {
            return {};
        }

        return {
            art: {
                ...season.art,
                tvshow: show.art
            }
        };
    }

    async repairRepositoryPaths ( season : string | TvSeasonMediaRecord, episodes : TvEpisodeMediaRecord[] = null ) : Promise<Partial<TvSeasonMediaRecord>> {
        if ( typeof season === 'string' ) {
            season = await this.get( season );
        }

        episodes = episodes ?? await this.relations.episodes.load( season );

        const repositoryPaths : string[] = [];

        for ( let episode of episodes ) {
            if ( episode.repositoryPaths instanceof Array ) {
                for ( let path of episode.repositoryPaths ) {
                    if ( !repositoryPaths.includes( path ) ) {
                        repositoryPaths.push( path );
                    }
                }
            }
        }

        return {
            repositoryPaths: repositoryPaths,
        };
    }

    async repair ( seasons : string[] = null ) {
        if ( !seasons ) {
            seasons = ( await this.find() ).map( season => season.id );
        }

        await super.repair( seasons );

        const seasonRecords = await this.findAll( seasons );
        let seasonEpisodes = await this.relations.episodes.loadAll( seasonRecords );
        const seasonShows = await this.relations.show.loadAll( seasonRecords );

        await this.database.tables.episodes.repair( seasonEpisodes.flat().map( episode => episode.id ) )

        // Reload the relation to get any updates made by the repair of the episodes
        seasonEpisodes = await this.relations.episodes.loadAll( seasonRecords );

        await Promise.all( seasonRecords.map( async ( season, index ) => {
            const episodes = seasonEpisodes[ index ];
            const show = seasonShows[ index ];

            const changes = {
                ...await this.repairEpisodesCount( season, episodes ),
                ...await this.repairTvShowArt( season, show ),
                ...await this.repairRepositoryPaths( season, episodes ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( season, { episodes } ),
            };

            await this.updateIfChanged( season, changes );

            Object.assign( season, changes );
        } ) );
    }
}

export interface TvSeasonMediaRecord extends MediaRecord {
    kind : MediaKind.TvSeason;
    art : TvSeasonMediaRecordArt;
    number : number;
    tvShowId : string;
    tvShowKind : MediaKind.TvShow;
    episodesCount : number;
    watchedEpisodesCount : number;
}

export interface TvSeasonMediaRecordSql extends MediaRecordSql {
    genres: string;
    tvShowId : number;
}

export interface TvSeasonMediaRecordArt extends MediaRecordArt {
    tvshow : MediaRecordArt;
}
