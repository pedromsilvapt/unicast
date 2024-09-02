import { MediaKind } from '../../MediaRecord';
import { Converters, FieldConverters } from '../Converters';
import { AbstractMediaTable, PlayableMediaRecord, PlayableMediaRecordSql } from './AbstractMediaTable';
import type { CollectionRecord } from './CollectionsTable';
import type { PersonRecord } from './PeopleTable';
import { ManyToManyRelation } from '../Relations/ManyToManyRelation';

export class MoviesMediaTable extends AbstractMediaTable<MovieMediaRecord> {
    readonly tableName : string = 'mediaMovies';

    readonly kind : MediaKind = MediaKind.Movie;

    fieldConverters: FieldConverters<MovieMediaRecord, MovieMediaRecordSql> = {
        id: Converters.id(),
        sources: Converters.json(),
        genres: Converters.json(),
        quality: Converters.json(),
        external: Converters.json(),
        art: Converters.json(),
        repositoryPaths: Converters.json(),
        watched: Converters.bool(),
        transient: Converters.bool(),
        addedAt: Converters.date(),
        createdAt: Converters.date(),
        updatedAt: Converters.date(),
        lastPlayedAt: Converters.date(),
        lastPlayedAtLegacy: Converters.json(),
    };
    
    dateFields = [ 'addedAt', 'lastPlayedAt' ];

    declare relations : {
        collections: ManyToManyRelation<MovieMediaRecord, CollectionRecord>,
        cast: ManyToManyRelation<MovieMediaRecord, PersonRecord>
    };

    baseline : Partial<MovieMediaRecord> = {
        watched: false,
        lastPlayedAt: null,
        playCount: 0,
        transient: false
    }

    async repair ( movies : string[] = null ) {
        if ( !movies ) {
            movies = ( await this.find() ).map( movie => movie.id );
        }

        await super.repair( movies );
        
        const movieRecords = await this.findAll( movies );

        await Promise.all( movieRecords.map( async movie => {
            const changes = {
                // TODO Extract from server into here
                ...await this.database.server.media.watchTracker.onPlayRepairChanges( movie ),
            }

            await this.updateIfChanged( movie, changes );

            Object.assign( movie, changes );
        } ) );
    }
}

export interface MovieMediaRecord extends PlayableMediaRecord {
    kind : MediaKind.Movie;
    rating : number;
    genres : string[];
    trailer : string;
    parentalRating : string;
    plot : string;
    year : number;
    tagline : string;
}

export interface MovieMediaRecordSql extends PlayableMediaRecordSql {
    genres: string;
}
