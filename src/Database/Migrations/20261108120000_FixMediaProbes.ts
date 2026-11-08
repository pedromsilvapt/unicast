import type { Knex } from 'knex';
import { AllMediaKinds } from '../../MediaRecord';

/**
 * The `mediaProbes` table was created without a primary key (`id` was a plain nullable integer) and without a unique
 * constraint on the media it belongs to. As a consequence:
 *  - rescanning a media record inserted a new probe row every time, instead of replacing the existing one;
 *  - most rows had `id = NULL`, and updating one of them by id (`WHERE id IS NULL`) overwrote all of them.
 *
 * This migration recreates the table with an auto-increment primary key and a unique `(mediaId, mediaKind)` constraint.
 * For each media record, only one probe is kept: the most recent one whose probed file matches the media's current
 * `sources[0].id`, while preserving the oldest `createdAt` among those matching rows. Probes that do not match the
 * current file of their media record are dropped, and can be recreated with the `ReprobeMedia` tool.
 */
export async function up ( knex : Knex ) : Promise<void> {
    const count = async ( table : string ) => ( await knex.table( table ).count( { count: '*' } ) )[ 0 ].count;

    await knex.schema.renameTable( 'mediaProbes', 'mediaProbes_old' );

    await knex.schema.createTable( 'mediaProbes', table => {
        table.increments( 'id' );
        table.integer( 'mediaId' );
        table.enum( 'mediaKind', AllMediaKinds );
        table.json( 'metadata' );
        table.json( 'raw' );
        table.timestamps( /* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true );

        table.foreign( [ 'mediaId', 'mediaKind' ] ).references( [ 'id', 'kind' ] ).inTable( 'media' ).onDelete( 'CASCADE' ).onUpdate( 'CASCADE' );
        table.unique( [ 'mediaId', 'mediaKind' ] );
    } );

    await knex.raw( `
        INSERT INTO mediaProbes ( mediaId, mediaKind, metadata, raw, createdAt, updatedAt )
        WITH sources AS (
            SELECT id, kind, json_extract( sources, '$[0].id' ) AS path FROM mediaMovies
            UNION ALL
            SELECT id, kind, json_extract( sources, '$[0].id' ) AS path FROM mediaTvEpisodes
            UNION ALL
            SELECT id, kind, json_extract( sources, '$[0].id' ) AS path FROM mediaCustom
        ),
        ranked AS (
            SELECT
                p.rowid AS rowNumber,
                p.mediaId, p.mediaKind, p.metadata, p.raw, p.updatedAt,
                MIN( p.createdAt ) OVER ( PARTITION BY p.mediaId, p.mediaKind ) AS createdAt,
                ROW_NUMBER() OVER ( PARTITION BY p.mediaId, p.mediaKind ORDER BY p.updatedAt DESC, p.rowid DESC ) AS rank
            FROM mediaProbes_old p
            INNER JOIN sources s ON s.id = p.mediaId AND s.kind = p.mediaKind
            WHERE json_extract( p.raw, '$.format.filename' ) = s.path
        )
        SELECT mediaId, mediaKind, metadata, raw, createdAt, updatedAt
        FROM ranked
        WHERE rank = 1
        ORDER BY rowNumber
    ` );

    const oldCount = +await count( 'mediaProbes_old' );
    const newCount = +await count( 'mediaProbes' );
    const oldMediaCount = +( await knex.table( 'mediaProbes_old' ).countDistinct( { count: 'mediaId' } ) )[ 0 ].count;

    console.log( `[FixMediaProbes] Probes before: ${ oldCount } (for ${ oldMediaCount } media records). ` +
                 `Kept: ${ newCount }. ` +
                 `Duplicates collapsed: ${ oldCount - oldMediaCount }. ` +
                 `Dropped because they did not match the media's current file: ${ oldMediaCount - newCount }.` );

    await knex.schema.dropTable( 'mediaProbes_old' );
}

export async function down ( knex : Knex ) : Promise<void> {
    // The dropped (stale or duplicate) probe rows cannot be restored, and the new schema is a strict improvement
    // over the old one, so there is nothing meaningful to revert.
}
