import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IScraper } from "./IScraper";
import { UnicastServer } from "../UnicastServer";
import { ScraperFactory } from "./ScraperFactory";
import { MediaKind, ExternalReferences, ArtRecord } from "../MediaRecord";
import { CacheOptions } from "../MediaProviders/ProvidersManager";
import { MediaRecord } from "../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";

export class ScrapersManager extends EntityManager<IScraper, string> {
    protected getEntityKey( scraper : IScraper ): string {
        return scraper.name;
    }

    getMedia ( scraperName : string, kind : MediaKind, id : string, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const scraper = this.get( scraperName );

        if ( kind == MediaKind.Movie ) {
            return scraper.getMovie( id, cache );
        } else if ( kind == MediaKind.TvShow ) {
            return scraper.getTvShow( id, cache );
        } else if ( kind === MediaKind.TvSeason ) {
            return scraper.getTvSeason( id, cache );
        } else if ( kind === MediaKind.TvEpisode ) {
            return scraper.getTvEpisode( id, cache );
        } else {
            return Promise.resolve( null );
        }
    }

    getMediaRelation ( scraperName : string, kind : MediaKind, relation : MediaKind, id : string, cache ?: CacheOptions ) : Promise<MediaRecord[]> {
        const scraper = this.get( scraperName );

        if ( kind === MediaKind.TvShow ) {
            if ( relation === MediaKind.TvSeason ) {
                return scraper.getTvShowSeasons( id, cache );
            } else if ( relation === MediaKind.TvEpisode ) {
                return scraper.getTvShowEpisodes( id, cache );
            }
        } else if ( kind === MediaKind.TvSeason && relation === MediaKind.TvEpisode ) {
            return scraper.getTvSeasonEpisodes( id, cache );
        } else {
            return Promise.resolve( [] );
        }
    }

    getMediaExternal ( scraperName : string, kind : MediaKind, external : ExternalReferences, cache ?: CacheOptions ) : Promise<MediaRecord> {
        const scraper = this.get( scraperName );

        if ( kind == MediaKind.Movie ) {
            return scraper.getMovieExternal( external, cache );
        } else if ( kind == MediaKind.TvShow ) {
            return scraper.getTvShowExternal( external, cache );
        } else if ( kind === MediaKind.TvSeason ) {
            return scraper.getTvSeasonExternal( external, cache );
        } else if ( kind === MediaKind.TvEpisode ) {
            return scraper.getTvEpisodeExternal( external, cache );
        } else {
            return null;
        }
    }

    async getMediaArtwork ( scraperName : string, kind : MediaKind, id : string, cache ?: CacheOptions ) : Promise<ArtRecord[]> {
        const scraper = this.get( scraperName );

        const record = await this.getMedia( scraperName, kind, id );

        return scraper.getMediaArt( record, null, cache );
    }

    async search ( scraperName : string, kind : MediaKind, query : string, limit ?: number, cache ?: CacheOptions ) : Promise<MediaRecord[]> {
        const scraper = this.get( scraperName );

        if ( kind === MediaKind.Movie ) {
            return scraper.searchMovie( query, limit, cache );
        } else if ( kind === MediaKind.TvShow ) {
            return scraper.searchTvShow( query, limit, cache );
        } else {
            return [];
        }
    }

    async parse ( scraperName : string, name : string ) : Promise<MediaRecord> {
        
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