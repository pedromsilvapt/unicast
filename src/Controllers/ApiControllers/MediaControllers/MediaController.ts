import { BaseTableController, RequestQuery } from "../../BaseTableController";
import { Request, Response } from "restify";
import { MediaRecord, ArtRecord, isPlayableRecord, PersonRecord } from "../../../MediaRecord";
import { Route } from "../../BaseController";
import { MediaTrigger } from "../../../TriggerDb";
import { AbstractMediaTable } from "../../../Database/Database";
import { ResourceNotFoundError, InvalidArgumentError } from 'restify-errors';
import { MediaRecordQuerySemantics, QueryAst, QueryLang, QuerySemantics } from '../../../QueryLang';
import { Knex } from 'knex';
import { PlayableMediaQualities } from './MoviesController';
import { DistinctMultipleJsonColumns } from '../../../Database/Tables/BaseTable';

export abstract class MediaTableController<R extends MediaRecord, T extends AbstractMediaTable<R> = AbstractMediaTable<R>> extends BaseTableController<R, T> {
    createCustomQuerySemantics ( req: Request, ast : QueryAst ) : QuerySemantics<R> {
        const semantics = new MediaRecordQuerySemantics();

        semantics.features.collection = QueryLang.hasIdentifier( ast, 'collection' );

        semantics.features.cast = QueryLang.hasIdentifier( ast, 'cast' );

        semantics.features.repository = QueryLang.hasIdentifier( ast, 'repository' );

        semantics.features.genre = QueryLang.hasIdentifier( ast, 'genre' );

        return semantics;
    }

    async runCustomQuery ( req: Request, records: R[] ) : Promise<R[]> {
        await this.table.relations.collections.applyAll( records );

        return super.runCustomQuery( req, records );
    }

    getQueryCustomOrder ( query: Knex.QueryBuilder, field: string, direction: 'asc' |  'desc', list: string ) : Knex.QueryBuilder {
        if ( field === '$userRank' ) {
            const userRanksTable = this.server.database.tables.userRanks;

            // Direction is intentionally reversed because for user ranks, by convention, we
            // decided that the first is the one with the bigger $userRank
            if ( direction === 'desc' ) {
                query = query.orderByRaw( `IFNULL(${ userRanksTable.tableName }.position, 0) ASC` );
            } else {
                query = query.orderByRaw( `IFNULL(${ userRanksTable.tableName }.position, 0) DESC` );
            }

            query = query
                .leftJoin(
                    userRanksTable.tableName,
                    join => join.on(this.table.tableName + '.id', '=', userRanksTable.tableName + '.mediaId')
                        .andOn(this.table.tableName + '.kind', '=', userRanksTable.tableName + '.mediaKind')
                        .andOnVal(userRanksTable.tableName + '.list', '=', list)
                )
                .select(this.table.tableName + '.*', this.table.raw(`IFNULL(${ userRanksTable.tableName }.position, 0) AS "$userRank"`))
            return query;
        } else {
            throw new InvalidArgumentError( `Custom ordering not supported for field '${ field }', only supported for '$userRank'.` );
        }
    }

    getTransientQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( req.query.transient == 'include' ) {
            return query.where( { transient: true } );
        } else if ( req.query.transient == 'exclude' || !req.query.transient ) {
            return query.where( { transient: false } );
        } else {
            return query;
        }
    }

    getSampleQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( req.query.sample ) {
            return query.whereIn( 'id', query.clone().select('id').clearOrder().orderByRaw( 'RANDOM()' ).limit( req.query.sample ) );
        } else {
            return query;
        }
    }

    getWatchedQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( req.query.filterWatched === 'include' ) {
            query = query.where( { watched: true } );
        } else if ( req.query.filterWatched === 'exclude' ) {
            query = query.where( { watched: false } );
        }

        return query;
    }

    getRepositoryPathsQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( typeof req.query.filterRepositories === 'object' ) {
            const repos = Object.keys( req.query.filterRepositories );

            const included = repos.filter( genre => req.query.filterRepositories[ genre ] === 'include' );
            const excluded = repos.filter( genre => req.query.filterRepositories[ genre ] === 'exclude' );

            if ( included.length > 0 ) {
                query = query.whereExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.repositoryPaths)` ).whereIn( 'value', included ) );
            }

            if ( excluded.length > 0 ) {
                query = query.whereNotExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.repositoryPaths)` ).whereIn( 'value', excluded ) );
            }
        }

        return query;
    }

    getGenresQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( typeof req.query.filterGenres === 'object' ) {
            const genres = Object.keys( req.query.filterGenres );

            const included = genres.filter( genre => req.query.filterGenres[ genre ] === 'include' );
            const excluded = genres.filter( genre => req.query.filterGenres[ genre ] === 'exclude' );

            if ( included.length > 0 ) {
                query = query.whereExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.genres)` ).whereIn( 'value', included ) );
            }

            if ( excluded.length > 0 ) {
                query = query.whereNotExists( q => q.select( 'value' ).fromRaw( `json_each(${ this.table.tableName }.genres)` ).whereIn( 'value', excluded ) );
            }
        }

        return query;
    }

    getCollectionsQuery ( req : Request, query : Knex.QueryBuilder ) : Knex.QueryBuilder {
        if ( typeof req.query.filterCollections === 'object' ) {
            const collections = Object.keys( req.query.filterCollections );

            const included = collections.filter( collection => req.query.filterCollections[ collection ] === 'include' );
            const excluded = collections.filter( collection => req.query.filterCollections[ collection ] === 'exclude' );

            if ( included.length > 0 ) {
                const collectionMedia = this.server.database.tables.collectionsMedia;

                const includedQuery = collectionMedia.query()
                    .select( 'mediaId' )
                    .whereIn( 'collectionId', included )
                    .whereRaw( `${ this.table.tableName }.id = ${ collectionMedia.tableName }.mediaId` );

                query = query.whereExists( includedQuery );
            }

            if ( excluded.length > 0 ) {
                const collectionMedia = this.server.database.tables.collectionsMedia;

                const excludedQuery = collectionMedia.query()
                    .select( 'mediaId' )
                    .whereIn( 'collectionId', excluded )
                    .whereRaw( `${ this.table.tableName }.id = ${ collectionMedia.tableName }.mediaId` );

                query = query.whereNotExists( excludedQuery );
            }
        }

        return query;
    }

    protected getMetadataFieldQuery ( query : Knex.QueryBuilder, tableName : string, field: string, filters?: Record<string, string> ) : Knex.QueryBuilder {
        // DANGER!! `field` should be a safe variable, not user inputted, or it can lead to SQL Injections!
        if ( typeof filters === 'object' ) {
            const keys = Object.keys( filters );

            const included = keys.filter( key => filters[ key ] === 'include' );
            const excluded = keys.filter( key => filters[ key ] === 'exclude' );

            if ( included.length > 0 ) {
                query = query.clone().whereExists( q => q.select( 'value' ).fromRaw( `json_each(${ tableName }.metadata, '$.${ field }')` ).whereIn( 'value', included ) );
            }

            if ( excluded.length > 0 ) {
                query = query.clone().whereNotExists( q => q.select( 'value' ).fromRaw( `json_each(${ tableName }.metadata, '$.${ field }')` ).whereIn( 'value', excluded ) );
            }
        }

        return query;
    }

    public getMetadataQuery ( req : Request, query : Knex.QueryBuilder, tableName : string ) : Knex.QueryBuilder {
        query = this.getMetadataFieldQuery( query, tableName, 'video.resolution', req.query.filterResolutions );
        query = this.getMetadataFieldQuery( query, tableName, 'video.codec', req.query.filterVideoCodecs );
        query = this.getMetadataFieldQuery( query, tableName, 'video.colorspace', req.query.filterColorspaces );
        query = this.getMetadataFieldQuery( query, tableName, 'video.bitdepth', req.query.filterBitdepths );
        query = this.getMetadataFieldQuery( query, tableName, 'audio.channels', req.query.filterChannels );
        query = this.getMetadataFieldQuery( query, tableName, 'audio.codec', req.query.filterAudioCodecs );
        query = this.getMetadataFieldQuery( query, tableName, 'audio.language', req.query.filterLanguages );
        query = this.getMetadataFieldQuery( query, tableName, 'source', req.query.filterSources );

        return query;
    }

    async transformAll ( req : Request, res : Response, records : R[] ) : Promise<any> {
        records = await super.transformAll( req, res, records );

        if ( req.query.cast == 'true' ) {
            await this.table.relations.cast.applyAll( records );

            const url = this.server.getMatchingUrl( req );

            for ( let record of records ) {
                for ( let person of ( record as any ).cast ) {
                    ( person as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, record.art );
                }
            }
        }

        return records;
    }

    @Route( 'get', '/:id/artwork' )
    async listArtwork ( req : Request, res : Response ) : Promise<ArtRecord[]> {
        const media : MediaRecord = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const url = this.server.getMatchingUrl( req );

        const images = await this.server.scrapers.getAllMediaArtork( media.kind, media.external, {}, { readCache: false } );

        return images.map( image => ( {
            ...image,
            url: this.server.artwork.getCachedRemoteImage( url, image.url )
        } ) );
    }

    @Route( 'post', '/:id/artwork' )
    async setArtwork ( req : Request, res : Response ) {
        const property = req.body.property;
        const artwork = req.body.artwork;

        if ( !property ) {
            throw new InvalidArgumentError( `When setting a media artwork, the 'property' can't be empty.` );
        }

        const validProperties = [ 'poster', 'background', 'banner', 'thumbnail' ];

        if ( !validProperties.includes( property ) ) {
            throw new InvalidArgumentError( `Expected the 'property' field to be one of [${ validProperties.join( ', ' ) }].` );
        }

        if ( !artwork ) {
            throw new InvalidArgumentError( `When setting a media artwork, the 'url' can't be empty.` );
        }

        const media : MediaRecord = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        await this.server.media.setArtwork( media, property, artwork );

        return media;
    }

    @Route( 'get', '/:id/triggers' )
    async triggers ( req : Request, res : Response ) : Promise<MediaTrigger[]> {
        const media : MediaRecord = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const triggers = await this.server.triggerdb.queryMediaRecord( media );

        return triggers;
    }

    @Route('get', '/:id/streams')
    async streams ( req : Request, res : Response ) {
        const media = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        if ( !isPlayableRecord( media ) ) {
            throw new InvalidArgumentError( 'Media is not playable.' );
        }

        const streams = await this.server.providers.streams( media.sources );

        return streams.map( s => ( {
            ...s.toJSON(),
            path: this.server.streams.getUrlFor( media.kind, media.id, s.id )
        } ) );
    }

    @Route('get', '/:id/collections')
    async collections ( req : Request, res : Response ) {
        const kind = this.server.media.getKind( this.table );

        return await this.server.media.getCollections( kind, req.params.id );
    }

    @Route( 'get', '/:id/cast' )
    async cast ( req : Request, res : Response ) : Promise<PersonRecord[]> {
        const media : MediaRecord = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const cast = await this.server.media.getCast( media );

        const url = this.server.getMatchingUrl( req );

        for ( let record of cast ) {
            ( record as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, record.art );
        }

        return cast;
    }

    @Route( 'get', '/:id/probe' )
    async probe ( req : Request, res : Response ) {
        const media = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const probe = await this.table.relations.probe.load( media );

        return probe;
    }

    @Route( 'post', '/:id/watch/:status' )
    async watch ( req : Request, res : Response ) : Promise<R> {
        const media = await this.table.tryGet( req.params.id );

        if ( !media ) {
            throw new ResourceNotFoundError( `Could not find resource with id "${ req.params.id }".` );
        }

        const watched : boolean = req.params.status === 'true';

        await this.server.media.watchTracker.watch( media, watched );

        return this.table.get( req.params.id );
    }

    @Route( 'get', '/qualities' )
    async qualities ( req : Request, res : Response ) {
        const columns: DistinctMultipleJsonColumns[] = [];

        const fields = req.query.fields as string[] | null;

        if ( fields == null || fields.includes( 'resolutions' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.video.resolution', result: 'resolutions' } );
        }

        if ( fields == null || fields.includes( 'video-codecs' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.video.codec', result: 'videoCodecs' } );
        }

        if ( fields == null || fields.includes( 'colorspaces' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.video.colorspace', result: 'colorspaces' } );
        }

        if ( fields == null || fields.includes( 'bitdepths' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.video.bitdepth', result: 'bitdepths' } );
        }

        if ( fields == null || fields.includes( 'audio-codecs' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.audio.codec', result: 'audioCodecs' } );
        }

        if ( fields == null || fields.includes( 'channels' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.audio.channels', result: 'channels' } );
        }

        if ( fields == null || fields.includes( 'languages' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.audio.language', result: 'languages' } );
        }

        if ( fields == null || fields.includes( 'sources' ) ) {
            columns.push( { column: 'metadata', jsonPath: '$.source', result: 'sources' } );
        }

        return await this.table.queryMultipleDistinctJsons<Partial<PlayableMediaQualities>>( columns );
    }
}
