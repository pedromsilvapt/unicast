import { Converters, FieldConverters } from '../Converters';
import { DatabaseTables } from '../Database';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';
import { HasManyRelation } from '../Relations/OneToManyRelation';
import { MediaKind, MediaRecord, MediaRecordSql, AbstractMediaTable } from './AbstractMediaTable';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import type { TvSeasonMediaRecord } from './TvSeasonsMediaTable';
import * as itt from 'itt';

export class TvShowsMediaTable extends AbstractMediaTable<TvShowMediaRecord> {
    readonly tableName : string = 'mediaTvShows';

    readonly kind : MediaKind = MediaKind.TvShow;

    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    baseline : Partial<TvShowMediaRecord> = {
        watched: false,
        watchedEpisodesCount: 0,
        episodesCount: 0,
        seasonsCount: 0,
        transient: false
    };

    fieldConverters: FieldConverters<TvShowMediaRecord, TvShowMediaRecordSql> = {
        id: Converters.id(),
        genres: Converters.json(),
        external: Converters.json(),
        art: Converters.json(),
        repositoryPaths: Converters.json(),
        watched: Converters.bool(),
        transient: Converters.bool(),
        addedAt: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
        lastPlayedAt: Converters.date(),
        lastPlayedAtLegacy: Converters.json()
    };
    
    declare relations : {
        collections: ManyToManyRelation<TvShowMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<TvShowMediaRecord, PersonRecord>,
        seasons: HasManyRelation<TvShowMediaRecord, TvSeasonMediaRecord>
    };

    installRelations ( tables : DatabaseTables ) {
        return {
            ...super.installRelations( tables ),
            seasons: new HasManyRelation( 'seasons', tables.seasons, 'tvShowId' ).orderBy( 'number' )
        };
    }

    async repairEpisodesCount ( show : string | TvShowMediaRecord, seasons : TvSeasonMediaRecord[] = null ) : Promise<Partial<TvShowMediaRecord>> {
        if ( typeof show === 'string' ) {
            show = await this.get( show );
        }

        seasons = seasons ?? await this.relations.seasons.load( show );

        const seasonsCount = seasons.length;

        const episodesCount = itt( seasons ).map( season => season.episodesCount ).sum();

        const watchedEpisodesCount = itt( seasons ).map( season => season.watchedEpisodesCount ).sum();

        return {
            watched: episodesCount == watchedEpisodesCount,
            seasonsCount, episodesCount, watchedEpisodesCount
        };
    }

    async repairRepositoryPaths ( show : string | TvShowMediaRecord, seasons : TvSeasonMediaRecord[] = null ) : Promise<Partial<TvShowMediaRecord>> {
        if ( typeof show === 'string' ) {
            show = await this.get( show );
        }

        seasons = seasons ?? await this.relations.seasons.load( show );

        const repositoryPaths : string[] = [];

        for ( let season of seasons ) {
            if ( season.repositoryPaths instanceof Array ) {
                for ( let path of season.repositoryPaths ) {
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

    async repair ( shows : string[] = null ) {
        if ( !shows ) {
            shows = ( await this.find() ).map( show => show.id );
        }

        await super.repair( shows );
        
        const showRecords = await this.findAll( shows );
        let showSeasons = await this.relations.seasons.loadAll( showRecords );

        await this.database.tables.seasons.repair( showSeasons.flat().map( season => season.id ) );
        
        // Reload the relation to get any updates made by the repair of the episodes
        showSeasons = await this.relations.seasons.loadAll( showRecords );
        
        await Promise.all( showRecords.map( async ( show, index ) => {
            const seasons = showSeasons[ index ];

            const changes = {
                ...await this.repairEpisodesCount( show, seasons ),
                ...await this.repairRepositoryPaths( show, seasons ),
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( show, { seasons } ),
            };

            await this.updateIfChanged( show, changes );
        } ) );
    }
}

export interface TvShowMediaRecord extends MediaRecord {
    kind : MediaKind.TvShow;
    episodesCount : number;
    genres : string[];
    plot : string;
    parentalRating : string;
    rating : number;
    seasonsCount : number;
    year : number;
    watchedEpisodesCount : number;
    watched : boolean;
    addedAt : Date;
}

export interface TvShowMediaRecordSql extends MediaRecordSql {
    genres: string;
    watched: number;
    addedAt: number;
}
