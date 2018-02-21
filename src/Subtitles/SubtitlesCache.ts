import { ISubtitle } from "./Providers/ISubtitlesProvider";
import { MediaRecord } from "../MediaRecord";
import * as cacheStream from 'cache-stream';

export class SubtitlesCache {
    // TODO Separate cached subtitles by subtitle provider
    // TODO Add locks to prevent duplicate ascynchronous requests
    downloads : Map<string, Promise<NodeJS.ReadableStream>> = new Map;

    searches : Map<string, Promise<ISubtitle[]>> = new Map;

    getSearchKey ( provider : string, lang : string, media : MediaRecord ) : string {
        return provider + '|' + lang + '|' + media.kind + '|' + media.id;
    }

    hasSearch ( provider : string, lang : string, media : MediaRecord ) : boolean {
        return this.searches.has( this.getSearchKey( provider, lang, media ) );
    }

    getSearch ( provider : string, lang : string, media : MediaRecord ) : Promise<ISubtitle[]> {
        return this.searches.get( this.getSearchKey( provider, lang, media ) );
    }

    setSearch ( provider : string, lang : string, media : MediaRecord, subtitles : Promise<ISubtitle[]> ) : this {
        this.searches.set( this.getSearchKey( provider, lang, media ), subtitles );

        return this;
    }

    wrapSearch ( provider : string, lang : string, media : MediaRecord, supplier : () => Promise<ISubtitle[]> ) : Promise<ISubtitle[]> {
        if ( !this.hasSearch( provider, lang, media ) ) {
            this.setSearch( provider, lang, media, supplier() );
        }
        
        return this.getSearch( provider, lang, media );
    }

    hasDownload ( subtitle : ISubtitle ) : boolean {
        return this.downloads.has( subtitle.id );
    }

    getDownload ( subtitle : ISubtitle ) : Promise<NodeJS.ReadableStream> {
        return this.downloads.get( subtitle.id );
    }

    setDownload ( subtitle : ISubtitle, stream : Promise<NodeJS.ReadableStream> ) : this {
        this.downloads.set( subtitle.id, stream.then( stream => stream.pipe( cacheStream() ) ) );

        return this;
    }

    wrapDownload ( subtitle : ISubtitle, supplier : () => Promise<NodeJS.ReadableStream> ) : Promise<NodeJS.ReadableStream> {
        if ( !this.hasDownload( subtitle ) ) {
            this.setDownload( subtitle, supplier() );
        }
        
        return this.getDownload( subtitle );
    }

    invalidate () {
        this.downloads = new Map();
        this.searches = new Map();
    }
}