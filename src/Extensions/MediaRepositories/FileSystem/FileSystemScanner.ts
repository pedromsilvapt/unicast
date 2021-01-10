import { MovieMediaRecord, TvEpisodeMediaRecord, TvShowMediaRecord, MediaRecord, PlayableQualityRecord, MediaKind, RecordsMap, TvSeasonMediaRecord, createRecordsMap } from "../../../MediaRecord";
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

export function isSameFile ( baseFolder : string, file1 : string, file2 : string ) : boolean {
    if ( !path.isAbsolute( file1 ) ) file1 = path.resolve( baseFolder, file1 );
    if ( !path.isAbsolute( file2 ) ) file2 = path.resolve( baseFolder, file2 );
    
    return file1 == file2;
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

    parseQuality ( file : string ) : PlayableQualityRecord {
        const quality = parseTorrentName( path.basename( file, path.extname( file ) ) ) || {};

        return {
            codec: quality.codec || null,
            releaseGroup: quality.group || null,
            resolution: quality.resolution || null,
            source: quality.quality || null
        };
    }

    async findMovieFor ( scraper : IScraper, id : string, title : string, year : number | null, query ?: IScraperQuery, cache : CacheOptions = {} ) : Promise<MovieMediaRecord> {
        const movieId = this.settings.get<string>( [ 'associations', 'movie', id ] );

        if ( !movieId ) {
            const titleQuery = typeof year === 'number' ? ( title + ` (${ year })` ) : title;
            
            return ( await scraper.searchMovie( titleQuery, 1, query, cache ) )[ 0 ];
        } else {
            return scraper.getMovie( movieId, query, cache );
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
                    
                    const localSettings = await this.getMovieLocalSettings( path.dirname( videoFile ) );
    
                    if ( !dirname ) {
                        logger.static().warn( `File ${ videoFile } is not inside a directory, will be skipped.` );

                        continue;
                    }

                    const details = parseTorrentName( dirname );

                    const fullVideoFile = path.join( folder, videoFile );

                    const id = this.server.hash( fullVideoFile );
    
                    let movie = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.Movie ).get( id ) as MovieMediaRecord ) );

                    if ( movie != null && !this.refreshConditions.testMovie( id ) ) {
                        yield movie;
    
                        continue;
                    }

                    this.removeIgnore( MediaKind.Movie, id );
    
                    const movieCache : CacheOptions = this.refreshConditions.testMovie( id ) ? { ...cache, readTtl: 60  } : cache;

                    // TODO We need to use || instead of ?? because the generated Typescript code is not hygienic otherwise
                    const movieName: string = localSettings.name || details.title;
                    const movieYear: number | null = localSettings.year || details.year;

                    movie = await this.findMovieFor( scraper, id, movieName, movieYear, {}, movieCache );

                    if ( !movie ) {
                        this.logScanError( MediaKind.Movie, videoFile, 'Cannot find movie ' + id + ' ' + details.title );
    
                        continue;
                    }
    
                    this.logScanInfo( 'Found', movie.id, movie.title, movie.year );
    
                    yield {
                        ...movie,
                        id: id,
                        internalId: movie.id,
                        sources: [ { "id": fullVideoFile } ],
                        quality: this.parseQuality( videoFile ),
                        addedAt: stats.mtime
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
    };

    async getMovieLocalSettings ( folder : string ) : Promise<MovieLocalSettings> {
        try {
            const localSettingsPath = path.join( folder, 'media.yaml' );

            if ( await fs.exists( localSettingsPath ) ) {
                var contents = await fs.readFile( localSettingsPath, { encoding: 'utf8' } );

                return yaml.load( contents );
            }
        } catch ( error ) {
            if ( this.logger != null ) {
                this.logger.error( `There was an unexpected error when retrieving the show's settings for "${ folder }": ${ error.message }` )
            }
        }

        return {};
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

        // Since each TV Show has many episodes, it would be wasteful to try and fetch it every time
        // So we simply save a cached version after the first episode to speed up the process
        let show : TvShowMediaRecord = this.showsByName.get( showName );

        const id = shorthash.unique( showName );

        if ( !show ) {
            // In case the option `refetchExisting` is false, the existing media records stored in the database are accessible in the 
            // `ignore` variable. We try to retrieve the record (show can therefore be null or not)
            show = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.TvShow ).get( id ) as TvShowMediaRecord ) );

            // If show is not null, we can simply store it for later, and move one
            if ( show != null && !this.refreshConditions.testTvShow( id ) ) {
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
            
        // Contains the entry stored in the pertaining to the current music 
        // file. If there was no entry, this variable is null
        const localSettingsEpisode = localSettings?.episodes
            ?.find( ep => isSameFile( folder, path.join( showName, ep.file ), videoFile ) );
        
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

        if ( season == null || this.refreshConditions.testTvSeason( id, seasonNumber ) ) {
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

        const episodeId = shorthash.unique( fullVideoFile );

        let episode = unwrap( clone( this.snapshot.recordsToIgnore.get( MediaKind.TvEpisode ).get( episodeId ) as TvEpisodeMediaRecord ) );
        
        if ( episode == null || this.refreshConditions.testTvEpisode( id, seasonNumber, episodeNumber ) ) {
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
            quality: this.parseQuality( videoFile ),
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
                        this.logScanError( MediaKind.TvEpisode, videoFile, error );
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
            throw new Error( `Invalid file system scanning type ${ this.config.content }` );
        }
    }
}

export interface TvShowLocalSettings {
    show?: {
        name?: string,
        id?: string | number;
    },
    episodes ?: {
        file: string,
        id?: string | number,
        override?: Partial<TvEpisodeMediaRecord>
    }[],
}

export interface MovieLocalSettings {
    name?: string;
    year?: string;
}