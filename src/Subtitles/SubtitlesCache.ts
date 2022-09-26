import { ISubtitle, ISubtitlesProvider, SearchOptions } from "./Providers/ISubtitlesProvider";
import { MediaRecord } from "../MediaRecord";
import * as cacheStream from 'cache-stream';

export class SubtitlesCache {
    // TODO Separate cached subtitles by subtitle provider
    // TODO Add locks to prevent duplicate ascynchronous requests
    downloads : Map<string, Promise<NodeJS.ReadableStream>> = new Map;

    searches : Map<string, Promise<ISubtitle[]>> = new Map;

    getSearchKey ( provider : string, options : SearchOptions, media : MediaRecord ) : string {
        return provider +
            '|' + options.lang +
            '|' + media.kind +
            '|' + media.id +
            '|' + ( options.seasonOffset ?? 0 ) +
            '|' + ( options.episodeOffset ?? 0 );
    }

    hasSearch ( provider : string, options : SearchOptions, media : MediaRecord ) : boolean {
        return this.searches.has( this.getSearchKey( provider, options, media ) );
    }

    getSearch ( provider : string, options : SearchOptions, media : MediaRecord ) : Promise<ISubtitle[]> {
        return this.searches.get( this.getSearchKey( provider, options, media ) );
    }

    setSearch ( provider : string, options : SearchOptions, media : MediaRecord, subtitles : Promise<ISubtitle[]> ) : this {
        this.searches.set( this.getSearchKey( provider, options, media ), subtitles );

        return this;
    }

    wrapSearch ( provider : ISubtitlesProvider, options : SearchOptions, media : MediaRecord, supplier : () => Promise<ISubtitle[]> ) : Promise<ISubtitle[]> {
        if ( provider.disableCaching ) {
            return supplier();
        }

        if ( !this.hasSearch( provider.name, options, media ) ) {
            this.setSearch( provider.name, options, media, supplier() );
        }

        return this.getSearch( provider.name, options, media );
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
