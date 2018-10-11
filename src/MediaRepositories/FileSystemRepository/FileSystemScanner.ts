import { MovieMediaRecord, TvEpisodeMediaRecord, TvShowMediaRecord, MediaRecord, PlayableQualityRecord, RecordsSet, MediaKind } from "../../MediaRecord";
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

    async * scanMovies ( ignore : RecordsSet ) : AsyncIterableIterator<MovieMediaRecord> {
        const walker = new VideosFileWalker( this.config.exclude || [] );

        const scraper = this.server.scrapers.get( this.config.scrapper );

        walker.useAbsolutePaths = false;

        for ( let folder of this.config.folders ) {
            for await ( let [ videoFile, stats ] of walker.run( folder ) ) {
                const dirname = path.basename( path.dirname( videoFile ) );

                const details = parseTorrentName( dirname );

                const id = shorthash.unique( videoFile );

                if ( ignore.get( MediaKind.Movie ).has( id ) ) {
                    // ignore this record, already have it
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
        const showId = this.settings.get<string>( [ 'associations', 'tvshow', name ] );

        if ( !showId ) {
            return ( await scraper.searchTvShow( name, 1 ) )[ 0 ];
        } else {
            return scraper.getTvShow( showId );
        }
    }

    async * scanEpisodeVideoFile ( ignore : RecordsSet, scraper : IScraper, folder : string, videoFile : string, stats : fs.Stats, showsByName : Map<string, TvShowMediaRecord>, seasonsFound : Set<string>, episodesFound : Set<string> ) : AsyncIterableIterator<MediaRecord> {
        const fullVideoFile = path.join( folder, videoFile );

        const episodeId = shorthash.unique( fullVideoFile );
        
        if ( ignore.get( MediaKind.TvEpisode ).has( episodeId ) ) {
            return;
        }

        const showName = pathRootName( videoFile );

        let show : TvShowMediaRecord = showsByName.get( showName );

        if ( !show ) {
            const id = shorthash.unique( showName );

            showsByName.set( showName, show = clone( await this.findTvShowFor( scraper, showName ) ) );

            if ( show != null ) {
                const showStats = await fs.stat( path.join( folder, showName ) );

                show.internalId = show.id;
                show.id = id;
                show.addedAt = showStats.mtime;

                if ( !ignore.get( MediaKind.TvShow ).has( id ) ) {
                    yield show;
                }
            } else {
                this.logScanError( videoFile, 'Cannot find show ' + id + ' ' + showName );
            }
        }

        if ( show == null ) {
            return;
        }

        const details = parseTorrentName( path.basename( videoFile ) );

        const logError = ( err ?: any ) => this.logScanError( videoFile, `Cannot find ${ show.title } ${ details.season } ${ details.episode }` + (err || '') );

        if ( isNaN( details.season ) || isNaN( details.episode ) ) {
            return logError();
        }

        const season = clone( await scraper.getTvShowSeason( show.internalId, details.season ) );

        if ( season == null ) {
            return logError();
        }

        season.internalId = season.id;
        season.id = shorthash.unique( season.id );
        season.tvShowId = show.id;

        if ( !seasonsFound.has( season.id ) ) {
            seasonsFound.add( season.id );

            if ( !ignore.get( MediaKind.TvSeason ).has( season.id ) ) {
                yield season;
            }
        }

        const episode = clone( await scraper.getTvShowEpisode( show.internalId, details.season, details.episode ).catch<TvEpisodeMediaRecord>( () => null ) );

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

    async * scanShows ( ignore : RecordsSet ) : AsyncIterableIterator<MediaRecord> {
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

    scan ( ignore : RecordsSet ) : AsyncIterableIterator<MediaRecord> {
        if ( this.config.content === MediaScanContent.Movies ) {
            return this.scanMovies( ignore );
        } else if ( this.config.content === MediaScanContent.TvShows ) {
            return this.scanShows( ignore );
        } else {
            throw new Error( `Invalid file system scanning type ${ this.config.content }` );
        }
    }
}
