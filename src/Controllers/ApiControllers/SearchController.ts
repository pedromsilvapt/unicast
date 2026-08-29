import { BaseController, Route, ValidateQuery } from "../BaseController";
import { Request, Response } from "restify";
import * as schema from '@gallant/schema';
import { Knex } from 'knex';
import {AbstractMediaTable, createMediaRecordPolyMap} from '../../Database/Database';
import { MediaKind, MediaRecord } from '../../MediaRecord';
import {BelongsToOnePolyRelation} from "../../Database/Relations/OneToOnePolyRelation";
import {PolyRelationMap} from "../../Database/Relations/PolyRelation";
import {pp} from "clui-logger";

interface SearchRow {
    kind : MediaKind;
    id : string;
    searchableTitle : string;
}

interface LoadedSearchRow extends SearchRow {
    record : MediaRecord
}

interface ParsedSearch {
    titlePart : string;
    seasonNumber : number | null;
    episodeNumber : number | null;
    hasTitle : boolean;
    hasNumbers : boolean;
    likeTitle : string;
}

export class SearchController extends BaseController {
    @ValidateQuery( schema.parse( `{
        query: string;
        take?: number;
    }`, schema.createDefaultOptions( { defaultNumberStrict: false, defaultBooleanStrict: false } ) ) )
    @Route( 'get', '/' )
    async searchMedia ( req : Request, res : Response ) : Promise<MediaRecord[]> {
        const query : string = req.query.query;

        if ( !query ) {
            return [];
        }

        const parsed = this.parseSearchQuery( query );
        const take = +( req.query.take ?? 10 );

        const union = this.buildUnionQuery( parsed, take );

        if ( union == null ) {
            return [];
        }

        const rows = await union as SearchRow[];

        const rowsWithRecords = await this.loadRecords( rows );

        return this.decorateResults( rowsWithRecords, this.server.getMatchingUrl( req ) );
    }

    private parseSearchQuery ( query : string ) : ParsedSearch {
        const match = query.match( /\bS(\d+)(?:E(\d+))?\b/i );

        let titlePart = query;
        let seasonNumber : number | null = null;
        let episodeNumber : number | null = null;

        if ( match ) {
            seasonNumber = +match[ 1 ];
            episodeNumber = match[ 2 ] ? +match[ 2 ] : null;
            titlePart = query.replace( match[ 0 ], ' ' ).replace( /\s+/g, ' ' ).trim();
        }

        return {
            titlePart,
            seasonNumber,
            episodeNumber,
            hasTitle: titlePart.length > 0,
            hasNumbers: seasonNumber != null,
            likeTitle: '%' + titlePart.replace(/ +/g, '%') + '%'
        };
    }

    private buildUnionQuery ( parsed : ParsedSearch, limit : number ) : Knex.QueryBuilder | null {
        const knex = this.server.database.connection;
        const tables = this.server.database.tables;

        const subQueries : Knex.QueryBuilder[] = [];

        if ( parsed.hasTitle ) {
            subQueries.push( this.buildSimpleTitleSubQuery( knex, MediaKind.Movie, tables.movies.tableName, parsed.likeTitle ) );
            subQueries.push( this.buildSimpleTitleSubQuery( knex, MediaKind.TvShow, tables.shows.tableName, parsed.likeTitle ) );
            subQueries.push( this.buildSimpleTitleSubQuery( knex, MediaKind.Custom, tables.custom.tableName, parsed.likeTitle ) );
        }

        if ( parsed.hasTitle || parsed.hasNumbers ) {
            subQueries.push( this.buildSeasonsSubQuery( knex, tables.seasons.tableName, tables.shows.tableName, parsed ) );
        }

        if ( parsed.hasTitle || parsed.hasNumbers ) {
            subQueries.push( this.buildEpisodesSubQuery( knex, tables.episodes.tableName, tables.seasons.tableName, tables.shows.tableName, parsed ) );
        }

        if ( subQueries.length === 0 ) {
            return null;
        }

        return knex.select( '*' ).from( knex.unionAll( subQueries ) ).limit( limit );
    }

    private buildSimpleTitleSubQuery (
        knex : Knex,
        kind : MediaKind,
        tableName : string,
        likeTitle : string
    ) : Knex.QueryBuilder {
        return knex.queryBuilder()
            .select( knex.raw( '? as kind', [ kind ] ), knex.raw( 'CAST( id AS TEXT ) as id' ), knex.raw( 'title as searchableTitle' ) )
            .from( tableName )
            .where( 'searchableTitle', 'like', likeTitle );
    }

    private buildSeasonsSubQuery (
        knex : Knex,
        seasonsTable : string,
        showsTable : string,
        parsed : ParsedSearch
    ) : Knex.QueryBuilder {
        const query = knex.queryBuilder()
            .select(
                knex.raw( '? as kind', [ MediaKind.TvSeason ] ),
                knex.raw( 'CAST( s.id AS TEXT ) as id' ),
                knex.raw( `s.title as searchableTitle` )
            )
            .from( { s: seasonsTable } )
            .join( { sh: showsTable }, 's.tvShowId', 'sh.id' );

        return this.applySeasonsWhere( query, parsed );
    }

    private applySeasonsWhere ( query : Knex.QueryBuilder, parsed : ParsedSearch ) : Knex.QueryBuilder {
        if ( parsed.hasTitle && parsed.hasNumbers ) {
            return query.where( builder => builder
                .where( 'searchableTitle', 'like', parsed.likeTitle )
                .andWhere( 's.number', parsed.seasonNumber )
            );
        } else if ( parsed.hasTitle ) {
            return query.where( 'searchableTitle', 'like', parsed.likeTitle );
        } else if ( parsed.hasNumbers ) {
            return query.where( 's.number', parsed.seasonNumber );
        } else {
            return query;
        }
    }

    private buildEpisodesSubQuery (
        knex : Knex,
        episodesTable : string,
        seasonsTable : string,
        showsTable : string,
        parsed : ParsedSearch
    ) : Knex.QueryBuilder {
        const query = knex.queryBuilder()
            .select(
                knex.raw( '? as kind', [ MediaKind.TvEpisode ] ),
                knex.raw( 'CAST( e.id AS TEXT ) as id' ),
                knex.raw(
                    `sh.title || ' S' || printf('%02d', e.seasonNumber) || 'E' || printf('%02d', e.number) || ' - ' || e.title as searchableTitle`
                )
            )
            .from( { e: episodesTable } )
            .join( { se: seasonsTable }, 'e.tvSeasonId', 'se.id' )
            .join( { sh: showsTable }, 'se.tvShowId', 'sh.id' );

        return this.applyEpisodesWhere( query, parsed );
    }

    private applyEpisodesWhere ( query : Knex.QueryBuilder, parsed : ParsedSearch ) : Knex.QueryBuilder {
        if ( parsed.hasTitle && parsed.hasNumbers ) {
            return query.where( builder => {
                builder.where( 'searchableTitle', 'like', parsed.likeTitle );

                if ( parsed.episodeNumber != null ) {
                    builder.andWhere( 'e.seasonNumber', parsed.seasonNumber )
                        .andWhere( 'e.number', parsed.episodeNumber );
                } else {
                    builder.andWhere( 'e.seasonNumber', parsed.seasonNumber );
                }
            } );
        } else if ( parsed.hasTitle ) {
            return query.where( 'searchableTitle', 'like', parsed.likeTitle );
        } else if ( parsed.episodeNumber != null ) {
            return query.where( 'e.seasonNumber', parsed.seasonNumber )
                .andWhere( 'e.number', parsed.episodeNumber );
        } else {
            return query.where( 'e.seasonNumber', parsed.seasonNumber );
        }
    }

    private async loadRecords ( rows : SearchRow[] ) : Promise<LoadedSearchRow[]> {
        const map : PolyRelationMap<MediaRecord> = createMediaRecordPolyMap( this.server.database.tables );

        let relation: BelongsToOnePolyRelation<SearchRow, MediaRecord, { record : MediaRecord }>
            = new BelongsToOnePolyRelation( 'record', map, 'kind', 'id' );

        return await relation.applyAll( rows );
    }

    private decorateResults ( rows : LoadedSearchRow[], url : string ) : MediaRecord[] {
        const results : MediaRecord[] = [];

        for ( const row of rows ) {
            const kind = row.kind as MediaKind;
            const record = row.record;

            if ( record == null ) {
                continue;
            }

            if ( kind === MediaKind.TvSeason || kind === MediaKind.TvEpisode ) {
                record.title = row.searchableTitle;
            }

            ( record as any ).cachedArtwork = this.server.artwork.getCachedObject(
                url, record.kind, record.id, record.art
            );

            results.push( record );
        }

        return results;
    }
}
