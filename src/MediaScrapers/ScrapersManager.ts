import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IScraper, IScraperQuery } from "./IScraper";
import { UnicastServer } from "../UnicastServer";
import { ScraperFactory } from "./ScraperFactory";
import { MediaKind, ExternalReferences, ArtRecord, RoleRecord } from "../MediaRecord";
import { CacheOptions } from "../MediaProviders/ProvidersManager";
import { MediaRecord } from "../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";

export class ScrapersManager extends EntityManager<IScraper, string> {
    protected getEntityKey( scraper : IScraper ): string {
        return scraper.name;
    }

    getMedia ( scraperName : string, kind : MediaKind, id : string, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const scraper = this.get( scraperName );

        if ( kind == MediaKind.Movie ) {
            return scraper.getMovie( id, query, cache );
        } else if ( kind == MediaKind.TvShow ) {
            return scraper.getTvShow( id, query, cache );
        } else if ( kind === MediaKind.TvSeason ) {
            return scraper.getTvSeason( id, query, cache );
        } else if ( kind === MediaKind.TvEpisode ) {
            return scraper.getTvEpisode( id, query, cache );
        } else {
            return Promise.resolve( null );
        }
    }

    getMediaRelation ( scraperName : string, kind : MediaKind, relation : MediaKind, id : string, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MediaRecord[]> {
        const scraper = this.get( scraperName );

        if ( kind === MediaKind.TvShow ) {
            if ( relation === MediaKind.TvSeason ) {
                return scraper.getTvShowSeasons( id, query, cache );
            } else if ( relation === MediaKind.TvEpisode ) {
                return scraper.getTvShowEpisodes( id, query, cache );
            }
        } else if ( kind === MediaKind.TvSeason && relation === MediaKind.TvEpisode ) {
            return scraper.getTvSeasonEpisodes( id, query, cache );
        } else {
            return Promise.resolve( [] );
        }
    }

    getMediaExternal ( scraperName : string, kind : MediaKind, external : ExternalReferences, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const scraper = this.get( scraperName );

        if ( kind == MediaKind.Movie ) {
            return scraper.getMovieExternal( external,query, cache );
        } else if ( kind == MediaKind.TvShow ) {
            return scraper.getTvShowExternal( external, query, cache );
        } else if ( kind === MediaKind.TvSeason ) {
            return scraper.getTvSeasonExternal( external, query, cache );
        } else if ( kind === MediaKind.TvEpisode ) {
            return scraper.getTvEpisodeExternal( external, query, cache );
        } else {
            return null;
        }
    }

    getMediaCast ( name : string, kind : MediaKind, id : string, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<RoleRecord[]> {
        const scraper = this.get( name );

        if ( kind == MediaKind.Movie ) {
            return scraper.getMovieCast( id, query, cache );
        } else if ( kind == MediaKind.TvShow ) {
            return scraper.getTvShowCast( id, query, cache );
        } else if ( kind === MediaKind.TvSeason ) {
            return scraper.getTvSeasonCast( id, query, cache );
        } else if ( kind === MediaKind.TvEpisode ) {
            return scraper.getTvEpisodeCast( id, query, cache );
        } else {
            return Promise.resolve( [] );
        }
    }

    async getMediaArtwork ( scraperName : string, kind : MediaKind, id : string, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const scraper = this.get( scraperName );

        const record = await this.getMedia( scraperName, kind, id );

        return scraper.getMediaArt( record, null, query, cache );
    }

    async getAllMediaArtork ( kind : MediaKind, external : ExternalReferences, query ?: IScraperQuery, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const artworks = await Promise.all( Array.from( this.keys() ).map( async name => {
            try {
                const record = await this.server.scrapers.getMediaExternal( name, kind, external, query, cache );

                if ( !record ) {
                    return [];
                }

                return this.getMediaArtwork( name, kind, record.id, query, cache );
            } catch ( error ) {
                this.server.onError.notify( error );
                
                return [];
            }
        } ) );

        return artworks.reduce( ( memo, items ) => memo.concat( items ), [] );
    }

    async search ( scraperName : string, kind : MediaKind, query : string, limit ?: number, queryOpts ?: IScraperQuery, cache ?: CacheOptions ) : Promise<MediaRecord[]> {
        const scraper = this.get( scraperName );

        if ( kind === MediaKind.Movie ) {
            return scraper.searchMovie( query, limit, queryOpts, cache );
        } else if ( kind === MediaKind.TvShow ) {
            return scraper.searchTvShow( query, limit, queryOpts, cache );
        } else {
            return [];
        }
    }

    async parse ( scraperName : string, name : string ) : Promise<Partial<MediaRecord>> {
        return {};
    }
}

export class ScraperFactoriesManager extends EntityFactoryManager<IScraper, ScrapersManager, ScraperFactory<IScraper>, string, string> {
    constructor ( receivers : ScrapersManager, server : UnicastServer ) {
        super( receivers, server );
    }

    protected getEntityKey ( entity : ScraperFactory<IScraper> ) : string {
        return entity.type;
    }
}