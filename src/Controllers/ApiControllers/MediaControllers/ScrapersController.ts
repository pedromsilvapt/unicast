import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { MediaKind, ExternalReferences, ArtRecord } from "../../../MediaRecord";
import { InvalidArgumentError } from "restify-errors";
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { CacheOptions } from "../../../MediaScrapers/ScraperCache";

export class ScrapersController extends BaseController {
    protected parseCacheOptions ( input : any ) : CacheOptions {
        if ( !input ) return {};

        let options : CacheOptions = {};

        if ( 'readTtl' in input ) {
            options.readTtl = +input.readTtl;
        }

        if ( 'readCache' in input ) {
            if ( typeof input.readCache === 'boolean' ) options.readCache = input.readCache;
            else if ( typeof input.readCache === 'string' ) {
                options.readCache = input.readCache.toLowerCase() == 'true' || input.readCache == '1';
            } else if ( typeof input.readCache === 'number' ) {
                options.readCache = !!input.readCache;
            }
        }

        if ( 'writeTtl' in input ) {
            options.readTtl = +input.readTtl;
        }

        if ( 'writeCache' in input ) {
            if ( typeof input.writeCache === 'boolean' ) options.writeCache = input.writeCache;
            else if ( typeof input.writeCache === 'string' ) {
                options.writeCache = input.writeCache.toLowerCase() == 'true' || input.writeCache == '1';
            } else if ( typeof input.writeCache === 'number' ) {
                options.writeCache = !!input.writeCache;
            }
        }
        
        return options;
    }

    /**
     * ROUTES:
     *  - /:scraper/:kind/external?external[:name]=:value
     *  - /:scraper/:kind/external/artwork?external[:name]=:value
     *  - /:scraper/:kind/external/:relation?external[:name]=:value
     *  - /:scraper/:kind/internal/:id
     *  - /:scraper/:kind/internal/:id/artwork
     *  - /:scraper/:kind/internal/:id/:relation
     *  - /:scraper/:kind/search?query=:value
     */

    @Route( 'get', '/:scraper/:kind/external' )
    async getExternal ( req : Request, res : Response ) : Promise<MediaRecord> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;

        const external : ExternalReferences = req.query.external;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Ìnvalid scraper name argument, no "${ name } scraper found."` );
        }

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMediaExternal( name, kind, external, cache );

        if ( record ) {
            const url = await this.server.getMatchingUrl( req );
        
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return record;
    }

    @Route( 'get', '/:scraper/:kind/external/artwork' )
    async getExternalArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        
        const external : ExternalReferences = req.query.external;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMediaExternal( name, kind, external, cache );

        if ( !record ) {
            throw new InvalidArgumentError( `Could not find the requested resource.` );
        }

        return this.server.scrapers.getMediaArtwork( name, kind, record.id );
    }

    // TODO NEXT Implement middleware validation through decorators
    
    @Route( 'get', '/:scraper/:kind/external/:relation' )
    async getExternalRelation ( req : Request, res : Response ) : Promise<MediaRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const relation : MediaKind = req.params.relation;
        
        const external : ExternalReferences = req.query.external;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }

        const cache = this.parseCacheOptions( req.query.cache );

        const parent = await this.server.scrapers.getMediaExternal( name, kind, external, cache );

        if ( !parent ) {
            throw new InvalidArgumentError( `Could not find the requested resource.` );
        }

        const records = await this.server.scrapers.getMediaRelation( name, kind, relation, parent.id, cache );
        
        const url = await this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return records;
    }

    @Route( 'get', '/:scraper/:kind/internal/:id' )
    async getInternal ( req : Request, res : Response ) : Promise<MediaRecord> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const id : string = req.params.id;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMedia( name, kind, id, cache );

        if ( record ) {
            const url = await this.server.getMatchingUrl( req );
        
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return record;
    }

    @Route( 'get', '/:scraper/:kind/internal/:id/artwork' )
    async getInternalArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const id : string = req.params.id;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }

        const cache = this.parseCacheOptions( req.query.cache );

        return this.server.scrapers.getMediaArtwork( name, kind, id, cache );
    }

    @Route( 'get', '/:scraper/:kind/internal/:id/:relation' )
    async getInternalRelation ( req : Request, res : Response ) : Promise<MediaRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const id : string = req.params.id;
        const relation : MediaKind = req.params.relation;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }
        
        const cache = this.parseCacheOptions( req.query.cache );

        const records = await this.server.scrapers.getMediaRelation( name, kind, relation, id, cache );
        
        const url = await this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return records;
    }

    @Route( 'get', '/:scraper/:kind/search' )
    async search ( req : Request, res : Response ) : Promise<MediaRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const query : string = req.query.query;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }

        const limit = +req.query.limit || 5;

        const cache = this.parseCacheOptions( req.query.cache );

        const records = await this.server.scrapers.search( name, kind, query, limit, cache );

        const url = await this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }
        
        return records;
    }
}