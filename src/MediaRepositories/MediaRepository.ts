import { IEntity } from "../EntityFactory";
import { UnicastServer } from "../UnicastServer";
import { MediaKind, MediaRecord, RecordsMap } from "../MediaRecord";
import { ISubtitlesRepository } from "../Subtitles/SubtitlesRepository";

// Why an Interface and an abstract class, I hear you asking?
// Because abstract classes in TypeScript don't allow, for some weird reason, optional methods, while interfaces do
// And thus with an interface we retain all the good static typing, and with the abstract class we get to implement any default behaviour
export interface IMediaRepository {
    server : UnicastServer;
    
    name : string;

    readonly indexable : boolean;

    readonly searchable : boolean;

    readonly ignoreUnreachableMedia : boolean;

    subtitles ?: ISubtitlesRepository;

    available () : Promise<boolean>;

    scan<T extends MediaRecord> ( filterKind ?: MediaKind[], ignore ?: RecordsMap<MediaRecord> ) : AsyncIterable<T>;

    search<T extends MediaRecord> ( query : string ) : Promise<T[]>;
    
    watch ? ( kind : MediaKind, id : string, watched ?: boolean ) : Promise<void>;

    isMediaReachable ( record : MediaRecord ) : Promise<boolean>;

    setPreferredMedia ( kind : MediaKind, matchedId : string, preferredId : string );

    getPreferredMedia ( kind : MediaKind, matchedId : string ) : string;

    getPreferredMediaArt ( kind : MediaKind, id : string, key : string ) : string;

    setPreferredMediaArt ( kind : MediaKind, id : string, key : string, url : string );
}

export abstract class MediaRepository implements IEntity, IMediaRepository {
    server : UnicastServer;

    public name : string;

    public abstract readonly indexable : boolean;

    public abstract readonly searchable : boolean;

    public abstract readonly ignoreUnreachableMedia : boolean;

    public readonly subtitles ?: ISubtitlesRepository;

    available () : Promise<boolean> {
        return Promise.resolve( true );
    }

    isMediaReachable ( record : MediaRecord ) : Promise<boolean> {
        return Promise.resolve( true );
    }

    abstract scan<T extends MediaRecord> ( filterKind ?: MediaKind[] ) : AsyncIterable<T>;

    abstract search<T extends MediaRecord> ( query : string ) : Promise<T[]>;

    abstract getPreferredMediaArt ( kind : MediaKind, id : string, key : string ) : string;

    abstract setPreferredMediaArt ( kind : MediaKind, id : string, key : string, url : string ) : void;

    abstract setPreferredMedia ( kind : MediaKind, matchedId : string, preferredId : string );

    abstract getPreferredMedia ( kind : MediaKind, matchedId : string ) : string;

}