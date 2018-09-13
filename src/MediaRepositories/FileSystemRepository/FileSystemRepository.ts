import { MediaRepository } from "../MediaRepository";
import { MediaRecord } from "../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { MediaKind } from "../../MediaRecord";
import { FileSystemScanner, FileSystemScannerConfig } from "./FileSystemScanner";
import { filter, map } from "data-async-iterators";
import { Settings } from "../../MediaScrapers/Settings";
import { FileSystemSubtitlesRepository } from "./FileSystemSubtitlesRepository";

export class FileSystemRepository extends MediaRepository {
    config : FileSystemScannerConfig;

    scanner : FileSystemScanner;

    settings : Settings;

    subtitles : FileSystemSubtitlesRepository;

    readonly indexable : boolean = true;

    readonly searchable : boolean = false;

    constructor ( name : string, config : FileSystemScannerConfig ) {
        super();

        this.name = name;

        this.config = config;
    }

    onEntityInit () {
        this.subtitles = new FileSystemSubtitlesRepository( this.server );

        this.settings = new Settings( this.server.storage.getPath( `settings/repositories/${ this.name }.json` ) );
    
        this.scanner = new FileSystemScanner( this.server, this.config, this.settings );

        this.server.onStart.subscribe( () => this.settings.load() );
    }

    scan<T extends MediaRecord>( filterKind : MediaKind[] = null ) : AsyncIterableIterator<T> {
        let records = this.scanner.scan() as AsyncIterableIterator<T>;

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
        this.scanner.settings.set( [ 'art', kind, id, key ], url );
    }

    getPreferredMediaArt ( kind : MediaKind, id : string, key : string ) : string {
        return this.scanner.settings.get<string>( [ 'art', kind, id, key ], null );
    }
}