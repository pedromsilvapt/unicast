import { Database } from "./Database";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, AllMediaKinds, MovieMediaRecord, MediaRecord, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord } from "./MediaRecord";
import { IMediaRepository, IMovieMediaRepository, ITvShowMediaRepository, ITvSeasonMediaRepository, ITvEpisodeMediaRepository, MediaQuery, TvSeasonMediaQuery, TvEpisodeMediaQuery } from "./MediaRepositories/BaseRepository/IMediaRepository";
import * as deepEqual from 'deep-equal';
import { BackgroundTask } from "./BackgroundTask";

export class MediaSync {
    database : Database;

    repositories : RepositoriesManager;

    constructor ( db : Database, repositories : RepositoriesManager ) {
        this.database = db;
        this.repositories = repositories;
    }

    async sync ( task : BackgroundTask = null, kinds : MediaKind[] = null ) : Promise<void> {
        task = task || new BackgroundTask();
        
        if ( !kinds ) {
            kinds = AllMediaKinds;
        }

        for ( let kind of kinds ) {
            await task.do( this.syncKind( kind, task ) );
        }

        task.finish();
    }

    protected async syncKind ( kind : MediaKind, task : BackgroundTask = null ) : Promise<void> {
        const indexable = this.repositories.getByKind( kind )
            .filter( repository => repository.indexable );

        for ( let repository of indexable ) {
            switch ( kind ) {
                case MediaKind.Movie:
                    await task.do( new MediaSyncMovie( this, repository as IMovieMediaRepository ).run( task, null ) );

                    break;
                case MediaKind.TvShow:
                    await task.do( new MediaSyncTvShow( this, repository as ITvShowMediaRepository ).run( task, null ) );

                    break;
            }
        }
    }
}

export abstract class MediaSyncKind<M extends MediaRecord, R extends IMediaRepository<M>> {
    engine : MediaSync;

    repository : R;

    constructor ( engine : MediaSync, repository : R ) {
        this.engine = engine;
        this.repository = repository;
    }

    abstract loadAllIndexed () : Promise<M[]>;

    abstract loadSingleIndexed ( id : string ) : Promise<M>;

    createRemoteQuery ( id ?: string ) : MediaQuery {
        return {};
    }

    async loadIndexed ( id ?: string ) : Promise<M[]> {
        if ( id ) {
            const item = await this.loadSingleIndexed( id );

            if ( item ) {
                return [ item ];
            }

            return [];
        }

        return this.loadAllIndexed();
    }

    async loadRemote ( id ?: string ) : Promise<M[]> {
        if ( id ) {
            const found = await this.repository.fetch( id, this.createRemoteQuery( id ) );
            
            if ( !found ) {
                return [];
            }
            
            return [ found ];
        }
        
        return this.repository.find( this.createRemoteQuery() );
    }

    protected groupByInternalId<R extends MediaRecord = MediaRecord> ( records : R[] ) : Map<string, R> {
        const map : Map<string, R> = new Map();

        for ( let record of records ) {
            map.set( record.internalId, record );
        }

        return map;
    }

    abstract async update ( existing : M, record : M ) : Promise<M>;

    abstract async create ( record : M ) : Promise<M>;

    async syncResources ( task : BackgroundTask, record : M ) : Promise<void> {}

    abstract compare ( a : M, b : M )  : boolean;

    protected equalFields<T, K extends keyof T> ( a : T, b : T, fields: K[] ) : boolean {
        const DIFFERENT = false;
        const EQUAL = true;

        if ( a === b ) {
            return EQUAL;
        }

        if ( typeof a !== typeof b ) {
            return DIFFERENT;
        }

        for ( let field of fields ) {
            if ( !deepEqual( a[ field ], b[ field ] ) ) {
                return DIFFERENT;
            }
        }

        return EQUAL;
    }
    
    async runRecord ( task : BackgroundTask, indexed : Map<string, M>, record : M ) : Promise<void> {
        if ( indexed.has( record.internalId ) ) {
            record = await this.update( indexed.get( record.internalId ), record );
        } else {
            record = await this.create( record );
        }

        task.addDone();

        await this.syncResources( task, record );
    }

    async run ( task : BackgroundTask, id ?: string ) : Promise<void> {
        const indexed = this.groupByInternalId( await this.loadIndexed( id ) );

        const remote = await this.loadRemote( id );

        task.addTotal( remote.length );

        const tasks : Promise<any>[] = [];

        for ( let record of remote ) {
            tasks.push( 
                task.do( this.runRecord( task, indexed, record ) )
            );
        }

        await Promise.all( tasks );
    }
}

export class MediaSyncMovie extends MediaSyncKind<MovieMediaRecord, IMovieMediaRepository> {
    async loadSingleIndexed ( id ?: string ) : Promise<MovieMediaRecord> {
        return this.engine.database.tables.movies.get( id );
    }

    async loadAllIndexed () : Promise<MovieMediaRecord[]> {
        return this.engine.database.tables.movies
            .find( query => query.filter( { repository: this.repository.name, kind: MediaKind.Movie } ) )
    }

    compare ( a : MovieMediaRecord, b : MovieMediaRecord ) : boolean {
        return this.equalFields( a, b, [ "title", "rating", "trailer", "parentalRating", "plot", "year", "tagline", "runtime", "art", "external", 'quality', "genres" ] );
    }

    async create ( record : MovieMediaRecord ) : Promise<MovieMediaRecord> {
        return this.engine.database.tables.movies.create( { ...record } );
    }

    async update ( existing : MovieMediaRecord, record : MovieMediaRecord ) {
        if ( !this.compare( existing, record ) ) {
            record = {
                id: existing.id,
                ...record,
                addedAt: existing.addedAt,
                watched: existing.watched,
                playCount: existing.playCount
            }

            return this.engine.database.tables.movies.update( existing.id, record );
        }

        return existing;
    }
}

export class MediaSyncTvShow extends MediaSyncKind<TvShowMediaRecord, ITvShowMediaRepository> {
    async loadSingleIndexed ( id : string ) : Promise<TvShowMediaRecord> {
        return this.engine.database.tables.shows.get( id );
    }

    async loadAllIndexed () : Promise<TvShowMediaRecord[]> {
        return this.engine.database.tables.shows
            .find( query => query.filter( { repository: this.repository.name, kind: MediaKind.TvShow } ) )
    }

    compare ( a : TvShowMediaRecord, b : TvShowMediaRecord ) : boolean {
        return this.equalFields( a, b, [ "title", "rating", "parentalRating", "plot", "year", "art", "external", "genres" ] );
    }

    async create ( record : TvShowMediaRecord ) : Promise<TvShowMediaRecord> {
        record = {
            ...record,
            internalId: record.internalId
        };

        delete record.id;

        return this.engine.database.tables.shows.create( record );
    }

    async update ( existing : TvShowMediaRecord, record : TvShowMediaRecord ) : Promise<TvShowMediaRecord> {
        if ( !this.compare( existing, record ) ) {
            record = {
                ...record,
                id: existing.id,
                addedAt: existing.addedAt,
                watched: existing.watched
            };

            await this.engine.database.tables.shows.update( existing.id, record );

            return record;
        }

        return existing;
    }

    async syncResources ( task : BackgroundTask, show : TvShowMediaRecord ) : Promise<void> {
        const repository = this.engine.repositories.get( this.repository.name, MediaKind.TvSeason ) as ITvSeasonMediaRepository;

        if ( repository ) {
            await new MediaSyncTvSeason( this.engine, repository, show ).run( task );
        }
    }
}

export class MediaSyncTvSeason extends MediaSyncKind<TvSeasonMediaRecord, ITvSeasonMediaRepository> {
    show : TvShowMediaRecord;

    constructor ( engine : MediaSync, repository : ITvSeasonMediaRepository, show : TvShowMediaRecord ) {
        super( engine, repository );

        this.show = show;
    }

    createRemoteQuery ( id : string ) : TvSeasonMediaQuery {
        if ( !id ) {
            return { show: this.show.internalId };
        }
    }

    async loadSingleIndexed ( id : string ) : Promise<TvSeasonMediaRecord> {
        return this.engine.database.tables.seasons.get( id );
    }

    async loadAllIndexed ( id ?: string ) : Promise<TvSeasonMediaRecord[]> {
        return this.engine.database.tables.seasons
            .find( query => query.filter( { repository: this.repository.name, kind: MediaKind.TvSeason, tvShowId: this.show.id } ) )
    }

    compare ( a : TvSeasonMediaRecord, b : TvSeasonMediaRecord ) : boolean {
        return this.equalFields( a, b, [ "art", "number", "external" ] );
    }

    async create ( record : TvSeasonMediaRecord ) : Promise<TvSeasonMediaRecord> {
        record = {
            ...record,
            internalId: record.internalId,
            tvShowId: this.show.id
        };

        delete record.id;

        return this.engine.database.tables.seasons.create( record );
    }

    async update ( existing : TvSeasonMediaRecord, record : TvSeasonMediaRecord ) : Promise<TvSeasonMediaRecord> {
        if ( !this.compare( existing, record ) ) {
            record = {
                ...record,
                id: existing.id,
                internalId: record.internalId,
                episodesCount: record.episodesCount,
                watchedEpisodesCount: record.watchedEpisodesCount,
                tvShowId: this.show.id
            };

            await this.engine.database.tables.seasons.update( existing.id, record );

            return record;
        }

        return existing;
    }

    async syncResources ( task : BackgroundTask, season : TvSeasonMediaRecord ) : Promise<void> {
        const repository = this.engine.repositories.get( this.repository.name, MediaKind.TvEpisode ) as ITvEpisodeMediaRepository;

        if ( repository ) {
            await new MediaSyncTvEpisode( this.engine, repository, this.show, season ).run( task );
            // console.log( `${ this.show.title } Season ${ season.number }` );
        }
    }
}

export class MediaSyncTvEpisode extends MediaSyncKind<TvEpisodeMediaRecord, ITvEpisodeMediaRepository> {
    show : TvShowMediaRecord;

    season : TvSeasonMediaRecord;

    constructor ( engine : MediaSync, repository : ITvEpisodeMediaRepository, show : TvShowMediaRecord, season : TvSeasonMediaRecord ) {
        super( engine, repository );

        this.show = show;
        this.season = season;
    }

    async loadSingleIndexed ( id : string ) : Promise<TvEpisodeMediaRecord> {
        return this.engine.database.tables.episodes.get( id );
    }

    async loadAllIndexed () : Promise<TvEpisodeMediaRecord[]> {
        return this.engine.database.tables.episodes
            .find( query => query.filter( { repository: this.repository.name, kind: MediaKind.TvEpisode, tvSeasonId: this.season.id } ) )
    }

    createRemoteQuery () : TvEpisodeMediaQuery {
        return { show: this.show.internalId, season: this.season.number };
    }

    compare ( a : TvEpisodeMediaRecord, b : TvEpisodeMediaRecord ) : boolean {
        return this.equalFields( a, b, [ "art", "quality", "external", "rating", "seasonNumber", "runtime", "watched" ] );
    }

    async create ( record : TvEpisodeMediaRecord ) : Promise<TvEpisodeMediaRecord> {
        record = {
            ...record,
            internalId: record.internalId,
            tvSeasonId: this.season.id
        };

        delete record.id;

        return this.engine.database.tables.episodes.create( record );
    }

    async update ( existing : TvEpisodeMediaRecord, record : TvEpisodeMediaRecord ) : Promise<TvEpisodeMediaRecord> {
        if ( !this.compare( existing, record ) ) {
            record = {
                ...record,
                id: existing.id,
                internalId: record.internalId,
                tvSeasonId: this.season.id
            };

            await this.engine.database.tables.episodes.update( existing.id, record );

            return record;
        }

        return existing;
    }
}