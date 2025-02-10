import { MovieMediaRecord, TvEpisodeMediaRecord, TvShowMediaRecord, MediaRecord, MediaKind, RecordsMap, TvSeasonMediaRecord, createRecordsMap } from "../../../MediaRecord";
import * as parseTorrentName from 'parse-torrent-name';
import { FileWalker } from "../../../ES2017/FileWalker";
import * as path from 'path';
import * as isVideo from 'is-video';
import * as fs from 'mz/fs';
import * as shorthash from 'shorthash';
import { UnicastServer } from "../../../UnicastServer";
import { IScraper, IScraperQuery } from "../../../MediaScrapers/IScraper";
import * as minimatch from 'minimatch';
import { Settings } from "../../../MediaScrapers/Settings";
import { LazyValue } from "../../../ES2017/LazyValue";
import { CacheOptions } from '../../../MediaScrapers/ScraperCache';
import { MediaRecordFiltersContainer } from '../../../MediaRepositories/ScanConditions';
import { MediaSyncSnapshot, MediaSyncTask } from '../../../MediaSync';
import { LoggerInterface } from 'clui-logger';
import * as yaml from 'js-yaml'
import { isSameFile, MovieLocalSettings, TvEpisodeLocalSettings, TvShowLocalSettings } from './LocalSettings';
import { MediaTools, ParsePathMode } from '../../../MediaTools';

function unwrap<T extends MediaRecord> ( obj : T ) : T {
    if ( obj == null ) {
        return obj;
    }

    obj.id = obj.internalId;

    obj.internalId = null;

    return obj;
}

function wrap<T extends MediaRecord> ( obj : T, id : string = null ) : T {
    if ( obj == null ) {
        return obj;
    }

    obj.internalId = obj.id;

    obj.id = id;

    return obj;
}

export function clone<T> ( obj : T ) : T {
    if ( obj ) {
        return { ...obj as any };
    }

    return obj;
}

export function pathRootName ( file : string ) {
    const segments = file.replace( /\\/g, '/' ).split( '/' );

    return segments.find( s => s != '..' && s != '.' );
}

export enum MediaScanContent {
    TvShows = "tvshows",
    Movies = "movies"
}

export interface FileSystemMountConfig {
    name: string;
    path: string;
    displayName?: string;
}

export interface FileSystemScannerConfigBase<M> {
    content : MediaScanContent;
    folders : string[];
    scrapper : string;
    exclude ?: (string | RegExp)[];
    ignoreUnreachableMedia ?: boolean;
    enableDefaultMounts ?: boolean;
    mounts ?: M[];
}

export interface FileSystemScannerConfig extends FileSystemScannerConfigBase<string | FileSystemMountConfig> {

}

export interface FileSystemScannerConfigNormalized extends FileSystemScannerConfigBase<FileSystemMountConfig> {

}

export class VideosFileWalker extends FileWalker {
    exclusionRules : RegExp[];

    constructor ( exclusionRules : (string | RegExp)[] = [] ) {
        super();

        this.exclusionRules = exclusionRules.map( rule => {
            if ( typeof rule === 'string' ) {
                return minimatch.makeRe( rule, { nocase: true, dot: true } ) as RegExp;
            }

            return rule;
        } );
    }

    async isExcluded ( base : string, file : string, stats : fs.Stats ) {
        const relative = path.relative( base, file ).replace( /\\/g, '/' );

        for ( let rule of this.exclusionRules ) {
            if ( rule.test( relative ) ) return true;
        }

        if ( stats.isDirectory() ) {
            return await fs.exists( path.join( file, '.nomedia' ) )
        }

        return !isVideo( file );
    }
}

export interface CommonLocalRecord {
    id: string;
    title: string;
    addedAt: Date;
}

export interface MovieLocalRecord extends CommonLocalRecord {
    kind: MediaKind.Movie;
    year: number;
    localSettings: MovieLocalSettings | null;
}

export interface TvShowLocalRecord extends CommonLocalRecord {
    kind: MediaKind.TvShow;
    localSettings: TvShowLocalSettings | null;
}

export interface TvSeasonLocalRecord extends CommonLocalRecord {
    kind: MediaKind.TvSeason;
    show: TvShowLocalRecord;
    number: number;
}

export interface TvEpisodeLocalRecord extends CommonLocalRecord {
    kind: MediaKind.TvEpisode;
    number: number;
    season: TvSeasonLocalRecord;
    localSettings: TvEpisodeLocalSettings | null;
}

export type TvLocalRecord = TvShowLocalRecord | TvSeasonLocalRecord | TvEpisodeLocalRecord;

export type LocalRecord = MovieLocalRecord | TvLocalRecord;

export class FileSystemScanner {
    server : UnicastServer;

    config : FileSystemScannerConfigNormalized;

    settings : Settings;

    // TODO placeholder for repository name
    name : string = 'filesystem';

    snapshot : MediaSyncSnapshot;

    logger : LoggerInterface;

    task : MediaSyncTask;

    refreshConditions : MediaRecordFiltersContainer = new MediaRecordFiltersContainer();

    protected showsByName : Map<string, TvShowMediaRecord> = new Map();

    protected seasonsFound : Set<string> = new Set();

    protected episodesFound : Set<string> = new Set();

    protected showsLocalSettings : Map<string, TvShowLocalSettings> = new Map();

    constructor ( server : UnicastServer, config : FileSystemScannerConfigNormalized, settings : Settings, reporter ?: MediaSyncTask | LoggerInterface ) {
        this.server = server;

        this.config = config;

        this.settings = settings;

        if ( reporter instanceof MediaSyncTask ) {
            this.task = reporter;
        } else {
            this.logger = reporter;
        }
    }

    async logScanError ( kind : MediaKind, file : string, error : any, parent ?: MediaRecord ) {
        if ( this.task != null ) {
            this.task.reportError( kind, error, parent, file );
        }

        if ( this.logger != null ) {
            // this.logger.error( file + ' ' + error );
        }
    }

    async logScanInfo ( ...info : any[] ) {
        if ( this.logger != null ) {
            // this.logger.info( info.join( ' ' ) );
        }
    }

    protected removeIgnore ( kind : MediaKind, id : string ) {
        const map = this.snapshot.recordsToIgnore.get( kind );

        if ( map != null ) {
            map.delete( id );
        }
    }

    /// Each show folder can contain a 'media.yaml' file that stores information
    /// to customize how the scanner will work with the show and it's seasons/episodes.
    async getTvShowLocalSettings ( folder : string, showName : string ) : Promise<TvShowLocalSettings> {
        // `showKey` represents the unique identifier for this show in the map
        // that stores both the locks, as well as the local settings for each show
        const showKey = path.join( folder, showName );

        try {
            if ( this.showsLocalSettings.has( showKey ) ) {
                return this.showsLocalSettings.get( showKey );
            }

            const localSettingsPath = path.join( folder, showName, 'media.yaml' );

            if ( await fs.exists( localSettingsPath ) ) {
                var contents = await fs.readFile( localSettingsPath, { encoding: 'utf8' } );

                var parsedContents = yaml.load( contents );

                this.showsLocalSettings.set( showKey, parsedContents );

                return parsedContents;
            } else {
                // If there are no custom settings, store an empty object instead
                this.showsLocalSettings.set( showKey, {} );
            }
        } catch ( error ) {
            this.showsLocalSettings.set( showKey, {} );

            if ( this.logger != null ) {
                this.logger.error( `There was an unexpected error when retrieving the show's settings for "${ showName }": ${ error.message }` )
            }
        }

        return {};
    }

    async getMovieLocalSettings ( folder : string ) : Promise<MovieLocalSettings> {
        try {
            const localSettingsPath = path.join( folder, 'media.yaml' );

            if ( await fs.exists( localSettingsPath ) ) {
                var contents = await fs.readFile( localSettingsPath, { encoding: 'utf8' } );

                return yaml.load( contents );
            }
        } catch ( error ) {
            if ( this.logger != null ) {
                this.logger.error( `There was an unexpected error when retrieving the movie's settings for "${ folder }": ${ error.message }` )
            }
        }

        return {};
    }

    async findMovieFor ( scraper : IScraper, id : string, title : string, year : number | null, externalMovieId : string = null, query ?: IScraperQuery, cache : CacheOptions = {} ) : Promise<MovieMediaRecord> {
        // External here stands for scraper movie id
        externalMovieId = externalMovieId || this.settings.get<string>( [ 'associations', 'movie', id ] );

        if ( !externalMovieId ) {
            const titleQuery = typeof year === 'number' ? ( title + ` (${ year })` ) : title;

            return ( await scraper.searchMovie( titleQuery, 1, query, cache ) )[ 0 ];
        } else {
            return scraper.getMovie( externalMovieId, query, cache );
        }
    }

    async * scanMovies ( cache : CacheOptions = {} ) : AsyncIterableIterator<MovieMediaRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        const scraper = this.server.scrapers.get( this.config.scrapper );

        walker.useAbsolutePaths = false;

        for ( let folder of this.config.folders ) {
            const logger = this.server.logger.service( 'repositories/scanner/movies/' + folder ).live();

            for await ( let [ videoFile, stats ] of walker.run( folder, null, logger ).buffered( 50 ) ) {
                try {
                    if ( this.task != null ) {
                        this.task.statusMessage = videoFile;
                    }

                    const dirname = path.basename( path.dirname( videoFile ) );

                    if ( !dirname ) {
                        logger.static().warn( `File ${ videoFile } is not inside a directory, will be skipped.` );

                        continue;
                    }

                    const details = parseTorrentName( dirname );

                    const fullVideoFile = path.join( folder, videoFile );

                    const id = this.server.hash( fullVideoFile );

                    let movie = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.Movie ).get( id ) as MovieMediaRecord ) );

                    if ( movie != null && !this.refreshConditions.testMovie( id ) && movie.scraper === scraper.name ) {
                        yield movie;

                        continue;
                    }

                    this.removeIgnore( MediaKind.Movie, id );

                    const movieCache : CacheOptions = this.refreshConditions.testMovie( id ) ? { ...cache, readTtl: 60  } : cache;

                    const localSettings = await this.getMovieLocalSettings( path.dirname( fullVideoFile ) );

                    // TODO We need to use || instead of ?? because the generated Typescript code is not hygienic otherwise
                    const movieName: string = localSettings.name || details.title;
                    const movieYear: number | null = localSettings.year || details.year;

                    const movieScraperId = localSettings.id;

                    movie = await this.findMovieFor( scraper, id, movieName, movieYear, movieScraperId, {}, movieCache );

                    if ( !movie ) {
                        this.logScanError( MediaKind.Movie, videoFile, 'Cannot find movie ' + id + ' ' + movieName + ' (' + movieYear + ')' );

                        continue;
                    }

                    this.logScanInfo( 'Found', movie.id, movie.title, movie.year );

                    yield {
                        ...movie,
                        id: id,
                        internalId: movie.id,
                        sources: [ { "id": fullVideoFile } ],
                        addedAt: stats.mtime,
                        ...localSettings?.override ?? {},
                    } as MovieMediaRecord;
                } catch ( error ) {
                    logger.static().error( videoFile + ' ' + error.message + '\n' + error.stack );
                }
            }

            logger.clear().close();
        }
    }

    async findTvShowFor ( scraper : IScraper, name : string, customShowId ?: string, query ?: IScraperQuery, cache : CacheOptions = {} ) : Promise<TvShowMediaRecord> {
        const showId = customShowId ?? this.settings.get<string>( [ 'associations', 'show', name ] );

        if ( !showId ) {
            return ( await scraper.searchTvShow( name, 1, query, cache ) )[ 0 ];
        } else {
            return scraper.getTvShow( showId, query, cache );
        }
    }

    async * scanEpisodeVideoFile ( scraper : IScraper, folder : string, videoFile : string, stats : fs.Stats, cache : CacheOptions = {} ) : AsyncIterableIterator<MediaRecord> {
        // `videoFile` is the relative file path. For instance, for a file located in
        // 'C:\Shows\Euphoria\Season 1\Euphoria 1x1.mkv', `videoFile` is gonna be
        // 'Euphoria\Season 1\Euphoria 1x1.mkv'

        // `diskShowName` will split the path segments and take the first one
        // that is not '.' or '..'. In the example above, `diskShowName` would be
        // 'Euphoria'
        const diskShowName = pathRootName( videoFile );

        const localSettings = await this.getTvShowLocalSettings( folder, diskShowName );

        // Is used for logical operations about the TV show (like getting information)
        // about it. `diskShowName` should only be used for IO operations regarding the
        // actual show's location in storage
        const showName = localSettings.show?.name ?? diskShowName;

        // Contains the entry stored in the pertaining to the current music
        // file. If there was no entry, this variable is null
        const localSettingsEpisode = localSettings?.episodes
            ?.find( ep => isSameFile( folder, path.join( showName, ep.file ), videoFile ) );

        if ( localSettingsEpisode?.ignore ?? false ) {
            return;
        }

        // Since each TV Show has many episodes, it would be wasteful to try and fetch it every time
        // So we simply save a cached version after the first episode to speed up the process
        let show : TvShowMediaRecord = this.showsByName.get( showName );

        const id = shorthash.unique( showName );

        if ( !show ) {
            // In case the option `refetchExisting` is false, the existing media records stored in the database are accessible in the
            // `ignore` variable. We try to retrieve the record (show can therefore be null or not)
            show = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.TvShow ).get( id ) as TvShowMediaRecord ) );

            // If show is not null, we can simply store it for later, and move one
            if ( show != null && !this.refreshConditions.testTvShow( id ) && show.scraper === scraper.name ) {
                this.showsByName.set( showName, show );
            } else {
                this.removeIgnore( MediaKind.TvShow, id );

                // Or if it is null, it must be a new show (or `refetchExisting` is true) and so we need to fetch it from the scraper
                const showCache : CacheOptions = this.refreshConditions.testTvShow( id ) ? { ...cache, readTtl: 60  } : cache;

                const remoteShowId = localSettings?.show?.id?.toString();

                this.showsByName.set( showName, show = clone( await this.findTvShowFor( scraper, showName, remoteShowId, {}, showCache ) ) );

                // If we found a show in the scraper
                if ( show != null ) {
                    const showStats = await fs.stat( path.join( folder, showName ) );

                    // The internalId for the repository is the id for the scraper
                    show.internalId = show.id;
                    // And the id for the repository is now the hash of the show name
                    show.id = id;
                    // Also, since this show is new, we should update the addedAt property
                    // TODO: Since this might happen when the show is NOT new, but refetchExisting is true, we need
                    // to check further down the line, when updating the record, that this new value doesn't overwrite the
                    // original addedAt
                    show.addedAt = showStats.mtime;
                }
            }

            // We only yield the show inside this if to not yield the same show more than once: once the show in the the
            // `showsByName` map, we can consider it has already been yielded
            if ( show != null ) {
                yield show;
            } else {
                this.logScanError( MediaKind.TvShow, videoFile, 'Cannot find show ' + id + ' ' + showName );
            }
        }

        // If we could not find a show for this video file by now, there's nothing to do from here
        // on forward regarding this file
        if ( show == null ) {
            return;
        }

        // We might not need this value (if both the season and the episode are already "cached") so it would be wasteful to get it now
        // But we might need it in one place, or both, and to prevent duplicating code, we wrap it in a lazy value
        // That has a .get() method, when called for the first time, retrieves the value, and for subsequent calls, returns the cached value
        let remoteShow = new LazyValue( async () => {
            if ( show.internalId ) {
                return show;
            }

            // TODO: findTvShowFor is already called somewhere up above; see if both calls cannot be merged into one to avoid
            // duplicate calls to the scraper when the cache reads are turned off
            return wrap( clone( await scraper.getTvShowExternal( show.external, {}, cache ) ), id );
        } );

        let remoteShowInternalId = remoteShow.map( show => show.internalId ).catch( err => {
            err.message = showName + ' ' + err.message;

            return Promise.reject( err );
        } );

        const details = parseTorrentName( path.basename( videoFile ) );

        let scraperSeasonNumber: number = details.season;
        let scraperEpisodeNumber: number = details.episode;

        if ( localSettingsEpisode?.id != null ) {
            var episodeInfo = await scraper.getTvEpisode( '' + localSettingsEpisode?.id, {}, cache );

            scraperSeasonNumber = episodeInfo.seasonNumber;
            scraperEpisodeNumber = episodeInfo.number;
        }

        // These values can be overriden in the media file. This allows the user
        // to customize how they want to organize their library
        let seasonNumber: number = localSettingsEpisode?.override?.seasonNumber ?? scraperSeasonNumber;
        let episodeNumber: number = localSettingsEpisode?.override?.number ?? scraperEpisodeNumber;

        const logError = ( err ?: any ) => this.logScanError( MediaKind.TvEpisode, videoFile, `Cannot find ${ show.title } ${ seasonNumber } ${ episodeNumber } ` + (err || ''), show );

        if ( isNaN( seasonNumber ) || isNaN( episodeNumber ) ) {
            return logError( 'Details isNaN' );
        }

        const seasonId = '' + show.id + 'S' + seasonNumber;

        let season = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.TvSeason ).get( seasonId ) as TvSeasonMediaRecord ) );

        if ( season == null || this.refreshConditions.testTvSeason( id, seasonNumber ) || season.scraper !== scraper.name ) {
            this.removeIgnore( MediaKind.TvSeason, seasonId );

            const seasonCache : CacheOptions = this.refreshConditions.testTvSeason( id, seasonNumber )
                ? { ...cache, readTtl: 60  }
                : cache;

            // We search for the `seasonNumber` instead of `scraperSeasonNumber`
            // because if the user has overriden the season where this episode is
            // to be stored, it makes no sense to get the other "original" season info
            season = clone( await scraper.getTvShowSeason( await remoteShowInternalId.get(), seasonNumber, {}, seasonCache ) );

            if ( season != null ) {
                season.internalId = season.id;
                season.id = seasonId;
                season.tvShowId = show.id;
                season.art.tvshow = show.art;
            }
        }

        if ( season == null ) {
            return logError( 'Season is null' );
        }

        if ( !this.seasonsFound.has( season.id ) ) {
            this.seasonsFound.add( season.id );

            yield season;
        }

        const fullVideoFile = path.join( folder, videoFile );

        const episodeId = this.server.hash( fullVideoFile );

        let episode = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.TvEpisode ).get( episodeId ) as TvEpisodeMediaRecord ) );

        if ( episode == null || this.refreshConditions.testTvEpisode( id, seasonNumber, episodeNumber ) || episode.scraper !== scraper.name ) {
            this.removeIgnore( MediaKind.TvEpisode, episodeId );

            const episodeCache : CacheOptions = this.refreshConditions.testTvEpisode( id, seasonNumber, episodeNumber )
                ? { ...cache, readTtl: 60  }
                : cache;

            const episodesConfig : IScraperQuery = {};

            // Note that here we use `scraperSeasonNumber` and `scraperEpisodeNumber`
            // to get the actual information about the episode, as opposed to what
            // we did for the season (where we searched for the `seasonNumber`)
            episode = clone( await scraper.getTvShowEpisode( await remoteShowInternalId.get(), scraperSeasonNumber, scraperEpisodeNumber, episodesConfig, episodeCache )
                .catch<TvEpisodeMediaRecord>( () => null ) );

            if ( episode != null ) {
                episode.art.tvshow = show.art;
            }
        } else {
            // If episode was supposed to be ignored, we can just yield it and exit from the function
            yield episode;

            return;
        }

        if ( episode == null ) {
            return logError( 'Episode is null' );
        }

        this.logScanInfo( 'Found', episode.id, show.title, seasonNumber, episodeNumber );

        yield {
            ...episode,
            id: episodeId,
            internalId: episode.id,
            tvSeasonId: season.id,
            sources: [ { "id": fullVideoFile } ],
            addedAt: stats.mtime,
            ...localSettingsEpisode?.override ?? {},
        } as TvEpisodeMediaRecord;
    }

    async * scanShows ( cache : CacheOptions = {} ) : AsyncIterableIterator<MediaRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        const scraper = this.server.scrapers.get( this.config.scrapper );

        walker.useAbsolutePaths = false;

        for ( let folder of this.config.folders ) {
            const logger = this.server.logger.service( 'repositories/scanner/shows/' + folder ).live();

            try {
                for await ( let [ videoFile, stats ] of walker.run( folder, null, logger ) ) {
                    try {
                        if ( this.task != null ) {
                            this.task.statusMessage = videoFile;
                        }

                        yield * this.scanEpisodeVideoFile( scraper, folder, videoFile, stats, cache );
                    } catch ( error ) {
                        this.logScanError( MediaKind.TvEpisode, videoFile, error.message );
                    }
                }
            } finally {
                logger.clear().close();
            }
        }
    }

    scan ( cache : CacheOptions = {} ) : AsyncIterable<MediaRecord> {
        if ( this.config.content === MediaScanContent.Movies ) {
            return this.scanMovies( cache );
        } else if ( this.config.content === MediaScanContent.TvShows ) {
            return this.scanShows( cache );
        } else {
            throw new Error( `Invalid file system scanning content type ${ this.config.content }` );
        }
    }

    public async * scanMoviesLocal () : AsyncIterableIterator<MovieLocalRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        walker.useAbsolutePaths = false;

        for ( let folder of this.config.folders ) {
            for await ( let [ videoFile, stats ] of walker.run( folder, null ).buffered( 50 ) ) {
                const dirname = path.basename( path.dirname( videoFile ) );

                const details = parseTorrentName( dirname );

                const fullVideoFile = path.join( folder, videoFile );

                const id = this.server.hash( fullVideoFile );

                const localSettings = await this.getMovieLocalSettings( path.dirname( fullVideoFile ) );

                const movieName: string = localSettings.name || details.title;
                const movieYear: number | null = localSettings.year || details.year;

                yield {
                    id: id,
                    kind: MediaKind.Movie,
                    localSettings: localSettings,
                    title: movieName,
                    year: movieYear,
                    addedAt: stats.mtime,
                };
            }
        }
    }

    public async * scanShowsLocal () : AsyncIterableIterator<TvLocalRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        walker.useAbsolutePaths = false;

        const showsById = new Map<string, TvShowLocalRecord>();

        const seasonsById = new Map<string, TvSeasonLocalRecord>();

        for ( let folder of this.config.folders ) {
            for await ( let [ videoFile, stats ] of walker.run( folder, null ) ) {
                // `videoFile` is the relative file path. For instance, for a file located in
                // 'C:\Shows\Euphoria\Season 1\Euphoria 1x1.mkv', `videoFile` is gonna be
                // 'Euphoria\Season 1\Euphoria 1x1.mkv'

                // `diskShowName` will split the path segments and take the first one
                // that is not '.' or '..'. In the example above, `diskShowName` would be
                // 'Euphoria'
                const diskShowName = pathRootName( videoFile );

                const localSettings = await this.getTvShowLocalSettings( folder, diskShowName );

                // Is used for logical operations about the TV show (like getting information)
                // about it. `diskShowName` should only be used for IO operations regarding the
                // actual show's location in storage
                const showName = localSettings.show?.name ?? diskShowName;

                // Contains the entry stored in the pertaining to the current music
                // file. If there was no entry, this variable is null
                const localSettingsEpisode = localSettings?.episodes
                    ?.find( ep => isSameFile( folder, path.join( diskShowName, ep.file ), videoFile ) );

                if ( localSettingsEpisode?.ignore ?? false ) {
                    return;
                }

                const id = shorthash.unique( showName );

                let show = showsById.get( id );

                if ( show == null ) {
                    const showStats = await fs.stat( path.join( folder, diskShowName ) );

                    show = {
                        kind: MediaKind.TvShow,
                        id: id,
                        localSettings: localSettings,
                        title: showName,
                        addedAt: showStats.mtime,
                    };

                    showsById.set( id, show );

                    yield show;
                }

                const details = parseTorrentName( path.basename( videoFile ) );

                let scraperSeasonNumber: number = details.season;
                let scraperEpisodeNumber: number = details.episode;

                // These values can be overriden in the media file. This allows the user
                // to customize how they want to organize their library
                let seasonNumber: number = localSettingsEpisode?.override?.seasonNumber ?? scraperSeasonNumber;
                let episodeNumber: number = localSettingsEpisode?.override?.number ?? scraperEpisodeNumber;

                if ( isNaN( seasonNumber ) || isNaN( episodeNumber ) ) {
                    continue;
                }

                const seasonId = '' + show.id + 'S' + seasonNumber;

                let season = seasonsById.get( seasonId );

                if ( season == null ) {
                    season = {
                        kind: MediaKind.TvSeason,
                        id: seasonId,
                        number: seasonNumber,
                        show: show,
                        title: show.title + ' Season ' + seasonNumber.toString(),
                        addedAt: null, // TODO
                    }

                    seasonsById.set( seasonId, season );

                    yield season;
                }

                const fullVideoFile = path.join( folder, videoFile );

                const episodeId = this.server.hash( fullVideoFile );

                yield {
                    kind: MediaKind.TvEpisode,
                    id: episodeId,
                    localSettings: localSettingsEpisode,
                    number: episodeNumber,
                    season: season,
                    title: show.title + `S${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')}`,
                    addedAt: stats.mtime,
                } as TvEpisodeLocalRecord;
            }
        }
    }

    /**
     * Performs a scan of the local file system, gathering as much information
     * locally about each potential media found, without attempting to scrape
     * information from any remote provider.
     * @returns
     */
    public scanLocal () : AsyncIterable<LocalRecord> {
        if ( this.config.content === MediaScanContent.Movies ) {
            return this.scanMoviesLocal();
        } else if ( this.config.content === MediaScanContent.TvShows ) {
            return this.scanShowsLocal();
        } else {
            throw new Error( `Invalid file system scanning content type ${ this.config.content }` );
        }
    }
}
