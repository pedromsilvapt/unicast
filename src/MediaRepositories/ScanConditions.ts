import { MediaRecord, MediaKind, isMovieRecord, isTvShowRecord, isTvSeasonRecord, isTvEpisodeRecord, RecordsSet, createRecordsSet } from '../MediaRecord';
import { MediaManager } from '../UnicastServer';
import { AsyncStream } from 'data-async-iterators';

export class FiltersContainer<F> {
    protected filters : F[] = [];

    public constructor ( filters : F[] = [] ) {
        this.filters = filters;
    }

    public set ( filters : F[] ) : void {
        this.filters = filters;
    }

    public add ( ...filters : F[] ) : void {
        this.filters.push( ...filters );
    }

    public clear () : void {
        this.filters = [];
    }
}

export interface MediaRecordFilter {
    testMovie ? ( id : string ) : boolean;

    testTvShow ? ( id : string ) : boolean;

    testTvSeason ? ( id : string, season : number ) : boolean;

    testTvEpisode ? ( id : string, season : number, episode : number ) : boolean;
}

export class MediaRecordFiltersContainer extends FiltersContainer<MediaRecordFilter> implements MediaRecordFilter {
    public testMovie ( id : string ) : boolean {
        return this.filters.some( filter => filter.testMovie && filter.testMovie( id ) );
    }

    public testTvShow ( id : string ) : boolean {
        return this.filters.some( filter => filter.testTvShow && filter.testTvShow( id ) );
    }

    public testTvSeason ( id : string, season : number ) : boolean {
        return this.filters.some( filter => filter.testTvSeason && filter.testTvSeason( id, season ) );
    }

    public testTvEpisode ( id : string, season : number, episode : number ) : boolean {
        return this.filters.some( filter => filter.testTvEpisode && filter.testTvEpisode( id, season, episode ) );
    }
}

export class TvMediaFilter implements MediaRecordFilter {
    public static show ( show : string, applyShow : boolean = true, applySeasons : boolean = true, applyEpisodes : boolean = true ) : TvMediaFilter {
        return TvMediaFilter.season( show, null, applyShow, applySeasons, applyEpisodes );
    }
    
    public static season ( show : string, season : number, applyShow : boolean = true, applySeasons : boolean = true, applyEpisodes : boolean = true ) : TvMediaFilter {
        return TvMediaFilter.episode( show, season, null, applyShow, applySeasons, applyEpisodes );
    }

    public static episode ( show : string, season : number, episode : number, applyShow : boolean = true, applySeasons : boolean = true, applyEpisodes : boolean = true ) : TvMediaFilter {
        const filter = new TvMediaFilter();

        filter.show = show;
        filter.season = season;
        filter.episode = episode;
        filter.applyShow = applyShow;
        filter.applySeasons = applySeasons;
        filter.applyEpisodes = applyEpisodes;
        
        return filter;
    }

    show : string = null;

    season : number = null;

    episode : number = null;

    applyShow : boolean = true;

    applySeasons : boolean = true;

    applyEpisodes : boolean = true;

    public testTvShow ( id : string ) : boolean {
        return ( this.show === null || this.show == id ) 
            && ( this.applyShow );
    }

    public testTvSeason ( id : string, season : number ) : boolean {
        return ( this.show === null || this.show === id )
            && ( this.season === null || this.season === season )
            && this.applySeasons;
    }

    public testTvEpisode ( id : string, season : number, episode : number ) : boolean {
        return ( this.show === null || this.show === id )
            && ( this.season === null || this.season === season )
            && ( this.episode === null || this.episode === episode )
            && this.applyEpisodes;
    }
}

export class MovieMediaFilter implements MediaRecordFilter {
    public static single ( id : string ) : MovieMediaFilter {
        const filter = new MovieMediaFilter();

        filter.movie = id;
        
        return filter;
    }

    movie : string;

    public testMovie ( id : string ) : boolean {
        return this.movie === null || this.movie === id;
    }
}

export class MediaSetFilter implements MediaRecordFilter {
    protected static async identifier ( record : MediaRecord, media : MediaManager ) : Promise<string> {
        if ( isMovieRecord( record ) || isTvShowRecord( record ) ) {
            return record.internalId;
        } else if ( isTvSeasonRecord( record ) ) {
            const tvShowId = await media.get( MediaKind.TvSeason, record.tvShowId );

            return `${ tvShowId.internalId }|${ record.number }`;
        } else if ( isTvEpisodeRecord( record ) ) {
            const tvSeason = await media.get( MediaKind.TvSeason, record.tvSeasonId );

            const tvShow = await media.get( MediaKind.TvShow, tvSeason.tvShowId );

            return `${ tvShow.internalId }|${ tvSeason.number }|${ record.number }`;
        } else {
            return null;
        }
    }

    public static async list ( records : Iterable<MediaRecord>, media : MediaManager ) : Promise<MediaSetFilter> {
        const set = createRecordsSet();

        await new AsyncStream( records )
            .parallel( async record => {
                const id = await MediaSetFilter.identifier( record, media );
                
                if ( id != null ) {
                    set.get( record.kind ).add( id );
                }
            }, 10 )
            .drain();

        return new MediaSetFilter( set );
    }

    recordsSet : RecordsSet;

    constructor ( set : RecordsSet ) {
        this.recordsSet = set;
    }

    public testMovie ( id : string ) : boolean {
        return this.recordsSet.get( MediaKind.Movie ).has( id );
    }

    public testTvShow ( id : string ) : boolean {
        return this.recordsSet.get( MediaKind.TvShow ).has( id );
    }

    public testTvSeason ( id : string, season : number ) : boolean {
        return this.recordsSet.get( MediaKind.TvSeason ).has( `${ id }|${ season }` );
    }

    public testTvEpisode ( id : string, season : number, episode : number ) : boolean {
        return this.recordsSet.get( MediaKind.TvEpisode ).has( `${ id }|${ season }|${ episode }` );
    }
}