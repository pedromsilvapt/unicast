import { MediaRecord, MediaKind, isMovieRecord, isTvShowRecord, isTvSeasonRecord, isTvEpisodeRecord } from '../MediaRecord';
import { MediaManager } from '../UnicastServer';

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

// export interface MediaRecordFilter {
//     test ( media : MediaManager, record : MediaRecord ) : Promise<boolean> | boolean;
// }

// export class MediaRecordFiltersContainer extends FiltersContainer<MediaRecordFilter> implements MediaRecordFilter {
//     public async test ( media : MediaManager, record : MediaRecord ) : Promise<boolean> {
//         for ( let filter of this.filters ) {
//             if ( await filter.test( media, record ) ) {
//                 return true;
//             }
//         }
        
//         return false;
//     }
// }

// export class MediaRecordFilterConverter implements MediaRecordFilter {
//     protected originalFilter : PreMediaRecordFilter;

//     protected useInternalId : boolean = true;

//     public constructor ( filter : PreMediaRecordFilter, useInternalId : boolean = true ) {
//         this.originalFilter = filter;
//         this.useInternalId = useInternalId;
//     }

//     public async test ( media : MediaManager, record : MediaRecord ) : Promise<boolean> {
//         if ( isMovieRecord( record ) && this.originalFilter.testMovie ) {
//             const id = this.useInternalId ? record.internalId : record.id;

//             return this.originalFilter.testMovie( id );
//         } else if ( isTvShowRecord( record ) && this.originalFilter.testTvShow ) {
//             const id = this.useInternalId ? record.internalId : record.id;

//             return this.originalFilter.testTvShow( id );
//         } else if ( isTvSeasonRecord( record ) && this.originalFilter.testTvSeason ) {
//             const show = await media.get( MediaKind.TvShow, record.tvShowId );

//             const id = this.useInternalId ? show.internalId : show.id;

//             return this.originalFilter.testTvSeason( id, record.number );
//         } else if ( isTvEpisodeRecord( record ) && this.originalFilter.testTvEpisode ) {
//             const season = await media.get( MediaKind.TvSeason, record.tvSeasonId );

//             const show = await media.get( MediaKind.TvShow, season.tvShowId );

//             const id = this.useInternalId ? show.internalId : show.id;

//             return this.originalFilter.testTvEpisode( id, record.seasonNumber, record.number );
//         } else {
//             return false;
//         }
//     }
// }

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
