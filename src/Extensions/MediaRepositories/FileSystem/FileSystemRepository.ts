import { IVirtualRepository, MediaRepository, VirtualRepositoryState } from "../../../MediaRepositories/MediaRepository";
import { MediaRecord, MediaKind, isPlayableRecord, PlayableMediaRecord, isMovieRecord, isTvEpisodeRecord, TvEpisodeMediaRecord, MovieMediaRecord } from "../../../MediaRecord";
import { FileSystemMountConfig, FileSystemScanner, FileSystemScannerConfig, FileSystemScannerConfigNormalized, MediaScanContent } from "./FileSystemScanner";
import { filter, map } from "data-async-iterators";
import { Settings } from "../../../MediaScrapers/Settings";
import { FileSystemSubtitlesRepository } from "./FileSystemSubtitlesRepository";
import { CacheOptions } from '../../../MediaScrapers/ScraperCache';
import * as fs from 'mz/fs';
import { MediaRecordFilter } from '../../../MediaRepositories/ScanConditions';
import { MediaSyncSnapshot, MediaSyncTask } from '../../../MediaSync';
import { LoggerInterface } from 'clui-logger';

export class FileSystemRepository extends MediaRepository {
    config : FileSystemScannerConfigNormalized;

    settings : Settings;

    subtitles : FileSystemSubtitlesRepository;

    readonly indexable : boolean = true;

    readonly searchable : boolean = false;

    readonly ignoreUnreachableMedia : boolean = false;

    readonly virtualRepositories: IVirtualRepository[] | null = null;

    readonly virtualRepositoryPrefixes: string[] | null = null;

    constructor ( name : string, config : FileSystemScannerConfig ) {
        super();

        this.name = name;

        this.config = FileSystemRepository.normalizeConfig( config );

        this.ignoreUnreachableMedia = Boolean( config.ignoreUnreachableMedia );

        this.virtualRepositories = this.cacheVirtualRepositories();

        this.virtualRepositoryPrefixes = this.cacheVirtualRepositoryPrefixes();
    }

    protected convertMountToVirtualRepository ( mount: FileSystemMountConfig ) : IVirtualRepository {
        return {
            name: this.name + '/' + mount.name,
            displayName: mount.displayName ?? mount.name,
            state: VirtualRepositoryState.Unknown,
        };
    }

    protected cacheVirtualRepositories () : IVirtualRepository[] | null {
        if ( this.config.mounts != null ) {
            return this.config.mounts.map( mount => this.convertMountToVirtualRepository( mount ) );
        } else if ( this.config.enableDefaultMounts ) {
            const repositoryNames = new Set<string>();

            const virtualRepositories: IVirtualRepository[] = [];

            for ( let folder of this.config.folders ) {
                const mount = this.getFilePathMount( null, folder );

                const repo = this.convertMountToVirtualRepository( mount );

                if ( repositoryNames.has( repo.name ) ) {
                    virtualRepositories.push( repo );

                    repositoryNames.add( repo.name );
                }
            }

            return virtualRepositories;
        } else {
            return null;
        }
    }
    
    protected cacheVirtualRepositoryPrefixes () : string[] | null {
        if ( this.config.mounts != null ) {
            return this.config.mounts.map( mount => mount.path );
        } else if ( this.config.enableDefaultMounts ) {
            const repositoryNames = new Set<string>();

            const virtualRepositories: string[] = [];

            for ( let folder of this.config.folders ) {
                const mount = this.getFilePathMount( null, folder );

                if ( mount == null ) continue;

                virtualRepositories.push( mount.path );
            }

            return virtualRepositories;
        } else {
            return null;
        }
    }

    findVirtualRepositoryForPath ( filePath : string ) : IVirtualRepository | null {
        if ( this.virtualRepositories == null ) {
            return null;
        }

        const mount = this.getFilePathMount( this.config.mounts, filePath );

        if ( mount == null ) return;

        const name = this.name + '/' + mount.name;

        return this.virtualRepositories.find( repo => repo.name == name ) ?? null;
    }

    hasMediaKind ( kind: MediaKind ) : boolean {
        if ( this.config.content === MediaScanContent.Movies ) {
            return kind === MediaKind.Movie;
        } else if ( this.config.content === MediaScanContent.TvShows ) {
            return kind === MediaKind.TvShow
                || kind === MediaKind.TvSeason
                || kind === MediaKind.TvEpisode;
        } else {
            return false;
        }
    }

    listVirtualRepositories () : Promise<IVirtualRepository[] | null> {
        return Promise.resolve( this.virtualRepositories );
    }

    getFilePathMount ( mounts : FileSystemMountConfig[], file : string ) : FileSystemMountConfig | null {
        if ( mounts != null ) {
            const customMount = mounts.find( m => file.startsWith( m.path ) );

            if ( customMount ) {
                return customMount;
            }
        }

        if ( this.config.enableDefaultMounts ) {
            if ( file.startsWith( file[ 0 ] + ':\\' ) ) {
                const letter = file[0].toUpperCase();

                return { 
                    name: 'drive-' + letter,
                    path: file.substr( 0, 3 ),
                    displayName: 'Drive ' + letter,
                };
            }
        }

        return null;
    }

    isMountReachable ( mount : FileSystemMountConfig ) : Promise<boolean> {
        return fs.stat( mount.path ).then( () => true, () => false );
    }

    async isMediaReachable ( media : MediaRecord ) : Promise<boolean> {
        if ( !isPlayableRecord( media ) ) {
            return true;
        }

        const file = media.sources[ 0 ].id;
        
        const mount = this.getFilePathMount( this.config.mounts, file );

        if ( mount ) {
            return this.isMountReachable( mount );
        }

        return true;
    }

    // TODO How about shows and seasons? They have an internal id but no sources
    public getUniqueId ( record : PlayableMediaRecord ) : string | null {
        if ( record.sources.length && record.sources[ 0 ].id ) {
            return this.server.hash( record.sources[ 0 ].id );
        }

        return null;
    }

    onEntityInit () {
        this.subtitles = new FileSystemSubtitlesRepository( this.server );

        this.settings = new Settings( this.server.storage.getPath( `settings/repositories/${ this.name }.json` ) );

        this.server.onStart.subscribe( () => this.settings.load() );
    }

    scan<T extends MediaRecord>( filterKind : MediaKind[] = null, snapshot : MediaSyncSnapshot, refreshConditions : MediaRecordFilter[] = [], cache : CacheOptions = {}, reporter : MediaSyncTask | LoggerInterface = null ) : AsyncIterable<T> {
        const scanner = new FileSystemScanner( this.server, this.config, this.settings, reporter );

        scanner.snapshot = snapshot;

        scanner.refreshConditions.set( refreshConditions );

        let records = scanner.scan( cache ) as AsyncIterable<T>;

        if ( filterKind ) {
            records = filter( records, record => filterKind.includes( record.kind ) );
        }

        records = map( records, record => this.placePreferredMediaArt( record ) as T );

        records = map( records, record => this.placeRepositoryPaths( record ) as T );

        return records;
    }

    search<T extends MediaRecord> ( query : string ) : Promise<T[]> {
        throw new Error("Method not implemented.");
    }

    placePreferredMediaArt ( record : MediaRecord ) : MediaRecord {
        record = { ...record, art: { ...record.art } } as MediaRecord;

        record.art.poster = this.getPreferredMediaArt( record.kind, record.id, 'poster' ) || record.art.poster;
        record.art.thumbnail = this.getPreferredMediaArt( record.kind, record.id, 'thumbnail' ) || record.art.thumbnail;
        record.art.banner = this.getPreferredMediaArt( record.kind, record.id, 'banner' ) || record.art.banner;
        record.art.background = this.getPreferredMediaArt( record.kind, record.id, 'background' ) || record.art.background;

        return record;
    }

    placeRepositoryPaths ( record : MediaRecord ) : MediaRecord {
        if ( isMovieRecord( record ) || isTvEpisodeRecord( record ) ) {
            record = { ...record };
        }

        if ( isMovieRecord( record ) || isTvEpisodeRecord( record ) ) {
            const file = record.sources[ 0 ].id;

            const repository = this.findVirtualRepositoryForPath( file );

            if ( repository != null ) {
                record.repositoryPaths = [ repository.name ];
            } else {
                record.repositoryPaths = [];
            }
        }

        return record;
    }

    setPreferredMediaArt ( kind : MediaKind, id : string, key : string, url : string ) {
        this.settings.set( [ 'art', kind, id, key ], url );
    }

    getPreferredMediaArt ( kind : MediaKind, id : string, key : string ) : string {
        return this.settings.get<string>( [ 'art', kind, id, key ], null );
    }

    setPreferredMedia ( kind : MediaKind, matchedId : string, preferredId : string ) {
        this.settings.set( [ 'associations', kind, matchedId ], preferredId );
    }
    
    getPreferredMedia ( kind : MediaKind, matchedId : string ) : string {
        return this.settings.get<string>( [ 'associations', kind, matchedId ] );
    }

    public static normalizeConfig ( config : FileSystemScannerConfig ) : FileSystemScannerConfigNormalized {
        const normalized : FileSystemScannerConfigNormalized = { 
            ...config, 
            ignoreUnreachableMedia: Boolean( config.ignoreUnreachableMedia ?? false ),
            folders: config.folders?.slice(),
            exclude: config.exclude?.slice(),
            mounts: [] 
        };

        if ( config.mounts instanceof Array ) {
            normalized.mounts = config.mounts.map( mount => {
                if ( typeof mount === 'string' ) {
                    return {
                        name: 'drive-' + mount,
                        path: mount,
                        displayName: 'Drive ' + mount,
                    };
                }

                return mount;
            } );
        }

        return normalized;
    }

    toJSON () : any {
        const json = super.toJSON();

        delete json.settings;

        return json;
    }
}