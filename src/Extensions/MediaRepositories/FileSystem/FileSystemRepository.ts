import { MediaRepository } from "../../../MediaRepositories/MediaRepository";
import { MediaRecord, MediaKind, isPlayableRecord, RecordsMap, createRecordsMap } from "../../../MediaRecord";
import { FileSystemScanner, FileSystemScannerConfig } from "./FileSystemScanner";
import { filter, map } from "data-async-iterators";
import { Settings } from "../../../MediaScrapers/Settings";
import { FileSystemSubtitlesRepository } from "./FileSystemSubtitlesRepository";
import { CacheOptions } from '../../../MediaScrapers/ScraperCache';
import * as fs from 'mz/fs';
import { TvMediaFilter, MediaRecordFilter } from '../../../MediaRepositories/ScanConditions';

export class FileSystemRepository extends MediaRepository {
    config : FileSystemScannerConfig;

    settings : Settings;

    subtitles : FileSystemSubtitlesRepository;

    readonly indexable : boolean = true;

    readonly searchable : boolean = false;

    readonly ignoreUnreachableMedia : boolean = false;

    constructor ( name : string, config : FileSystemScannerConfig ) {
        super();

        this.name = name;

        this.config = config;

        this.ignoreUnreachableMedia = Boolean( config.ignoreUnreachableMedia );
    }

    getFilePathMount ( mounts : string[], file : string ) : string {
        if ( mounts != null ) {
            const customMount = mounts.find( m => file.startsWith( m ) );
    
            if ( customMount ) {
                return customMount;
            }
        }

        if ( this.config.enableDefaultMounts ) {
            if ( file.startsWith( file[ 0 ] + ':\\' ) ) {
                return file.substr( 0, 3 );
            }
        }

        return null;
    }

    isMountReachable ( mount : string ) : Promise<boolean> {
        return fs.stat( mount ).then( () => true, () => false );
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

    onEntityInit () {
        this.subtitles = new FileSystemSubtitlesRepository( this.server );

        this.settings = new Settings( this.server.storage.getPath( `settings/repositories/${ this.name }.json` ) );

        this.server.onStart.subscribe( () => this.settings.load() );
    }

    scan<T extends MediaRecord>( filterKind : MediaKind[] = null, ignore : RecordsMap<MediaRecord> = createRecordsMap(), refreshConditions : MediaRecordFilter[] = [], cache : CacheOptions = {} ) : AsyncIterable<T> {
        const scanner = new FileSystemScanner( this.server, this.config, this.settings );

        scanner.ignore = ignore;

        scanner.refreshConditions.set( refreshConditions );

        let records = scanner.scan( cache ) as AsyncIterable<T>;

        if ( filterKind ) {
            records = filter( records, record => filterKind.includes( record.kind ) );
        }

        records = map( records, record => this.placePreferredMediaArt( record ) as T );

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
}