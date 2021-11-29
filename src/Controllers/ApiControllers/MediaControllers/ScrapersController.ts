import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { MediaKind, ExternalReferences, ArtRecord, RoleRecord } from "../../../MediaRecord";
import { InvalidArgumentError } from "restify-errors";
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { CacheOptions } from "../../../MediaScrapers/ScraperCache";
import { IScraperQuery } from '../../../MediaScrapers/IScraper';
import { MediaTools } from '../../../MediaTools';

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

    protected parseQueryOptions ( input : any ) : IScraperQuery {
        if ( !input ) return {};

        const query : IScraperQuery = {};

        if ( 'year' in input ) {
            query.year = +input.year;
        }

        if ( 'boxSet' in input ) {
            query.boxSet = input.boxSet;
        }

        if ( 'language' in input ) {
            query.language = input.language;
        }
        
        return query;
    }

    @Route( 'get', '/parse' )
    async parse ( req : Request, res : Response ) : Promise<any> {
        if ( req.query.name instanceof Array ) {
            return req.query.name.map( name => MediaTools.parseName( name ) );
        } else {
            return MediaTools.parseName( req.query.name );
        }
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

        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMediaExternal( name, kind, external, query, cache );

        if ( record ) {
            const url = this.server.getMatchingUrl( req );
        
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return record;
    }
    
    @Route( 'get', '/all/:kind/external/artwork' )
    async getAllExternalArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const kind : MediaKind = req.params.kind;
        
        const external : ExternalReferences = req.query.external;

        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }
        
        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        return this.server.scrapers.getAllMediaArtork( kind, external, query, cache );
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

        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMediaExternal( name, kind, external, query, cache );

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

        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const parent = await this.server.scrapers.getMediaExternal( name, kind, external, query, cache );

        if ( !parent ) {
            throw new InvalidArgumentError( `Could not find the requested resource.` );
        }

        const records = await this.server.scrapers.getMediaRelation( name, kind, relation, parent.id, query, cache );
        
        const url = this.server.getMatchingUrl( req );

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

        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const record = await this.server.scrapers.getMedia( name, kind, id, query, cache );

        if ( record ) {
            const url = this.server.getMatchingUrl( req );
        
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

        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        return this.server.scrapers.getMediaArtwork( name, kind, id, query, cache );
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
        
        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const records = await this.server.scrapers.getMediaRelation( name, kind, relation, id, query, cache );
        
        const url = this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }

        return records;
    }

    
    @Route( 'get', '/:scraper/:kind/internal/:id/cast' )
    async getCast ( req : Request, res : Response ) : Promise<RoleRecord[]> {
        const name : string = req.params.scraper;
        const kind : MediaKind = req.params.kind;
        const id : string = req.params.id;
        
        if ( ![ MediaKind.Movie, MediaKind.TvSeason, MediaKind.TvShow, MediaKind.TvEpisode ].includes( kind ) ) {
            throw new InvalidArgumentError( `Invalid kind argument, expected "movie", "show", "season" or "episode".` );
        }

        if ( !this.server.scrapers.hasKeyed( name ) ) {
            throw new InvalidArgumentError( `Invalid scraper name argument, no "${ name } scraper found."` );
        }
        
        const query = this.parseQueryOptions( req.query.query );

        const cache = this.parseCacheOptions( req.query.cache );

        const records = await this.server.scrapers.getMediaCast( name, kind, id, query, cache );
        
        const url = this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, record.art );
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

        const queryOpts = this.parseQueryOptions( req.query.queryOpts );

        const cache = this.parseCacheOptions( req.query.cache );

        const records = await this.server.scrapers.search( name, kind, query, limit, queryOpts, cache );

        const url = this.server.getMatchingUrl( req );

        for ( let record of records ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedScraperObject( url, name, record.kind, record.id, record.art );
        }
        
        return records;
    }
}