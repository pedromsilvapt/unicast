import { ISubtitle } from "./Providers/ISubtitlesProvider";
import { MediaRecord } from "../MediaRecord";

export class SubtitlesCache {
    // TODO Separate cached subtitles by subtitle provider
    // TODO Add locks to prevent duplicate ascynchronous requests
    downloads : Map<string, NodeJS.ReadableStream> = new Map;

    searches : Map<string, ISubtitle[]> = new Map;

    hasSearch ( provider : string, lang : string, media : MediaRecord ) : boolean {
        return this.searches.has( provider + '|' + lang + '|' + media.kind + '|' + media.id );
    }

    getSearch ( provider : string, lang : string, media : MediaRecord ) : ISubtitle[] {
        return this.searches.get( provider + '|' + lang + '|' + media.kind + '|' + media.id );
    }

    setSearch ( provider : string, lang : string, media : MediaRecord, subtitles : ISubtitle[] ) : this {
        this.searches.set( provider + '|' + lang + '|' + media.kind + '|' + media.id, subtitles );

        return this;
    }

    hasDownload ( subtitle : ISubtitle ) : boolean {
        return this.downloads.has( subtitle.id );
    }

    getDownload ( subtitle : ISubtitle ) : NodeJS.ReadableStream {
        return this.downloads.get( subtitle.id );
    }

    setDownload ( subtitle : ISubtitle, stream : NodeJS.ReadableStream ) : this {
        this.downloads.set( subtitle.id, stream );

        return this;
    }

    invalidate () {
        this.downloads = new Map();
        this.searches = new Map();
    }
}