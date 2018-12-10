import { MovieMediaRecord, TvEpisodeMediaRecord, TvShowMediaRecord, MediaRecord, PlayableQualityRecord, RecordsSet, MediaKind, RecordsMap, TvSeasonMediaRecord } from "../../MediaRecord";
import * as parseTorrentName from 'parse-torrent-name';
import { FileWalker } from "../../ES2017/FileWalker";
import * as path from 'path';
import * as isVideo from 'is-video';
import * as fs from 'mz/fs';
import * as shorthash from 'shorthash';
import { UnicastServer } from "../../UnicastServer";
import { IScraper } from "../../MediaScrapers/IScraper";
import * as minimatch from 'minimatch';
import { Settings } from "../../MediaScrapers/Settings";
import { LazyValue } from "../../ES2017/LazyValue";

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

export interface FileSystemScannerConfig {
    content : MediaScanContent;
    folders : string[];
    scrapper : string;
    exclude ?: (string | RegExp)[];
    ignoreUnreachableMedia ?: boolean;
    enableDefaultMounts ?: boolean;
    mounts ?: string[];
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

    config : FileSystemScannerConfig;

    settings : Settings;

    // TODO placeholder for repository name
    name : string = 'filesystem';

    constructor ( server : UnicastServer, config : FileSystemScannerConfig, settings : Settings ) {
        this.server = server;

        this.config = config;

        this.settings = settings;
    }

    async logScanError ( file : string, error : any ) {
        // console.error( file, error );
    }

    async logScanInfo ( ...info : any[] ) {
        // console.log( ...info );
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

    async findMovieFor ( scraper : IScraper, id : string, details : any ) : Promise<MovieMediaRecord> {
        const movieId = this.settings.get<string>( [ 'associations', 'movie', id ] );

        if ( !movieId ) {
            const title = typeof details.year === 'number' ? ( details.title + ` (${ details.year })` ) : details.title;
                    
            return ( await scraper.searchMovie( title, 1 ) )[ 0 ];
        } else {
            return scraper.getMovie( movieId );
        }
    }

    async * scanMovies ( ignore : RecordsMap<MediaRecord> ) : AsyncIterableIterator<MovieMediaRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        const scraper = this.server.scrapers.get( this.config.scrapper );

        walker.useAbsolutePaths = false;

        for ( let folder of this.config.folders ) {
            for await ( let [ videoFile, stats ] of walker.run( folder ).buffered( 50 ) ) {
                const dirname = path.basename( path.dirname( videoFile ) );

                const details = parseTorrentName( dirname );

                const id = shorthash.unique( videoFile );

                if ( ignore.get( MediaKind.Movie ).has( id ) ) {
                    yield unwrap( clone( ignore.get( MediaKind.Movie ).get( id ) as MovieMediaRecord ) );

                    continue;
                }

                const movie = await this.findMovieFor( scraper, id, details );

                if ( !movie ) {
                    this.logScanError( videoFile, 'Cannot find movie ' + id + ' ' + details.title );

                    continue;
                }

                this.logScanInfo( 'Found', movie.id, movie.title, movie.year );

                yield {
                    ...movie,
                    id: id,
                    internalId: movie.id,
                    sources: [ { "id": path.join( folder, videoFile ) } ],
                    quality: this.parseQuality( videoFile ),
                    addedAt: stats.mtime
                } as MovieMediaRecord;
            }
        }
    }

    async findTvShowFor ( scraper : IScraper, name : string ) : Promise<TvShowMediaRecord> {
        const showId = this.settings.get<string>( [ 'associations', 'show', name ] );

        if ( !showId ) {
            return ( await scraper.searchTvShow( name, 1 ) )[ 0 ];
        } else {
            return scraper.getTvShow( showId );
        }
    }

    async * scanEpisodeVideoFile ( ignore : RecordsMap<MediaRecord>, scraper : IScraper, folder : string, videoFile : string, stats : fs.Stats, showsByName : Map<string, TvShowMediaRecord>, seasonsFound : Set<string>, episodesFound : Set<string> ) : AsyncIterableIterator<MediaRecord> {
        // if ( ignore.get( MediaKind.TvEpisode ).has( episodeId ) ) {
        //     return;
        // }

        const showName = pathRootName( videoFile );

        let show : TvShowMediaRecord = showsByName.get( showName );

        const id = shorthash.unique( showName );

        if ( !show ) {
            show = unwrap( clone( ignore.get( MediaKind.TvShow ).get( id ) as TvShowMediaRecord ) );

            if ( show ) {
                showsByName.set( showName, show );
            } else {
                showsByName.set( showName, show = clone( await this.findTvShowFor( scraper, showName ) ) );

                if ( !show ) {
                    const showStats = await fs.stat( path.join( folder, showName ) );

                    show.internalId = show.id;
                    show.id = id;
                    show.addedAt = showStats.mtime;
                }
            }

            if ( show != null ) {
                yield show;
            } else {
                this.logScanError( videoFile, 'Cannot find show ' + id + ' ' + showName );
            }
        }

        if ( show == null ) {
            return;
        }

        
        let remoteShow = new LazyValue( async () => {
            if ( show.internalId ) {
                return show;
            }

            return wrap( clone( await this.findTvShowFor( scraper, showName ) ), id );
        } );

        let remoteShowInternalId = remoteShow.map( show => show.internalId );

        const details = parseTorrentName( path.basename( videoFile ) );

        const logError = ( err ?: any ) => this.logScanError( videoFile, `Cannot find ${ show.title } ${ details.season } ${ details.episode }` + (err || '') );

        if ( isNaN( details.season ) || isNaN( details.episode ) ) {
            return logError();
        }

        const seasonId = '' + show.id + 'S' + details.season;

        let season = unwrap( clone( ignore.get( MediaKind.TvSeason ).get( seasonId ) as TvSeasonMediaRecord ) );

        if ( season != null ) {
            season = clone( await scraper.getTvShowSeason( await remoteShowInternalId.get(), details.season ) );

            if ( season != null ) {
                season.internalId = season.id;
                season.id = seasonId;
                season.tvShowId = show.id;
            }
        }

        if ( season == null ) {
            return logError();
        }

        if ( !seasonsFound.has( season.id ) ) {
            seasonsFound.add( season.id );

            yield season;
        }

        const fullVideoFile = path.join( folder, videoFile );

        const episodeId = shorthash.unique( fullVideoFile );

        let episode = unwrap( clone( ignore.get( MediaKind.TvEpisode ).get( episodeId ) as TvEpisodeMediaRecord ) );
        
        if ( episode == null ) {
            episode = clone( await scraper.getTvShowEpisode( await remoteShowInternalId.get(), details.season, details.episode ).catch<TvEpisodeMediaRecord>( () => null ) );
        } else {
            // If episode was supposed to be ignored, we can just yield it and exit from the function
            yield episode;

            return;
        }

        if ( episode == null ) {
            return logError();
        }
        
        this.logScanInfo( 'Found', episode.id, show.title, details.season, details.episode );

        yield {
            ...episode,
            id: episodeId,
            internalId: episode.id,
            tvSeasonId: season.id,
            sources: [ { "id": fullVideoFile } ],
            quality: this.parseQuality( videoFile ),
            addedAt: stats.mtime
        } as TvEpisodeMediaRecord;
    }

    async * scanShows ( ignore : RecordsMap<MediaRecord> ) : AsyncIterableIterator<MediaRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        const scraper = this.server.scrapers.get( this.config.scrapper );

        walker.useAbsolutePaths = false;

        const showsByName : Map<string, TvShowMediaRecord> = new Map();

        const seasonsFound : Set<string> = new Set();

        const episodesFound : Set<string> = new Set();

        for ( let folder of this.config.folders ) {
            for await ( let [ videoFile, stats ] of walker.run( folder ) ) {
                try {
                    yield * this.scanEpisodeVideoFile( ignore, scraper, folder, videoFile, stats, showsByName, seasonsFound, episodesFound );
                } catch ( error ) {
                    this.logScanError( videoFile, error );
                }
            }
        }
    }

    scan ( ignore : RecordsMap<MediaRecord> ) : AsyncIterable<MediaRecord> {
        if ( this.config.content === MediaScanContent.Movies ) {
            return this.scanMovies( ignore );
        } else if ( this.config.content === MediaScanContent.TvShows ) {
            return this.scanShows( ignore );
        } else {
            throw new Error( `Invalid file system scanning type ${ this.config.content }` );
        }
    }
}
