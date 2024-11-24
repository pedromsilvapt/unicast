import type { Knex } from 'knex';
import { AllMediaKinds, MediaKind } from '../../MediaRecord';
import { collect, distinct, first, groupingBy, mapping } from 'data-collectors';
import { chunk } from '../Tables/BaseTable';

export async function up(knex: Knex): Promise<void> {
    const rows = await knex.table('history').select();

    await materializeMediaRecords(knex, rows);

    await knex.schema.renameTable('history', 'history_old');

    await knex.schema.createTable('history', table => {
        table.increments('id');
        table.integer('playlistId').nullable();
        table.integer('playlistPosition').nullable();
        table.integer('position').nullable();
        table.json('positionHistory');
        table.string('receiver');
        table.integer('mediaId').nullable();
        table.enum('mediaKind', AllMediaKinds).nullable();
        table.string('mediaTitle'); // Materialized column
        table.string('mediaSubTitle').nullable(); // Materialized column
        table.json('mediaSources'); // Materialized column
        table.json('transcoding').nullable();
        table.boolean('watched').defaultTo(false);
        table.string('importedFrom').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.foreign('playlistId').references('id').inTable('playlists').onDelete('SET NULL').onUpdate('CASCADE');
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('SET NULL').onUpdate('CASCADE');
    });

    const chunkSize = Math.floor(500 / (Object.keys(rows[0]).length));

    for (const chunkRows of chunk(rows, chunkSize)) {
        await knex.table('history').insert(chunkRows);
    }

    await knex.schema.dropTableIfExists('history_old');

    // Make the old foreign key references point to the new table
    await knex.schema.renameTable('history', 'history_old');
    await knex.schema.renameTable('history_old', 'history');
}

export async function down(knex: Knex): Promise<void> {
    // return knex.schema
    //     .dropTableIfExists('history')
    //     ;
}

async function materializeMediaRecords(knex: Knex, rows: any[]) {
    const rowsByKind = collect(rows,
        groupingBy(record => record.mediaKind as MediaKind,
        mapping(record => record.mediaId as string,
        distinct<string>()
    )));

    const mediaRecordsById = new Map<MediaKind, Map<string, any>>();

    for (const [kind, mediaIds] of rowsByKind) {
        const tableName = getTableNameForKind(kind);

        let query: Knex.QueryBuilder;
        // If it is an episode, include information about the tv show title
        if (kind == MediaKind.TvEpisode) {
            query = knex.table(tableName).select(
                'mediaTvEpisodes.id',
                'mediaTvEpisodes.kind',
                'mediaTvEpisodes.title',
                'mediaTvEpisodes.sources',
                'mediaTvEpisodes.number',
                'mediaTvEpisodes.seasonNumber',
                knex.raw('mediaTvShows.title AS showTitle')
            )
                .leftJoin('mediaTvSeasons', 'mediaTvSeasons.id', 'mediaTvEpisodes.tvSeasonId')
                .leftJoin('mediaTvShows', 'mediaTvShows.id', 'mediaTvSeasons.tvShowId')
        } else {
            query = knex.table(tableName).select('id', 'kind', 'title', 'sources');
        }

        query = query.whereIn(tableName + '.id', mediaIds);

        const mediaRecords = await query;

        mediaRecordsById.set(kind, collect(mediaRecords,
            groupingBy(media => media.id, first())
        ));
    }

    for (const historyRecord of rows) {
        const mediaRecord = mediaRecordsById
            .get(historyRecord.mediaKind)
            .get(historyRecord.mediaId);

        historyRecord.mediaTitle = mediaRecord?.title ?? '<No title>';
        historyRecord.mediaSources = mediaRecord?.sources ?? '{}';

        // We include the name of the TvShow, as well as the number of the
        // season and of the episode on the mediaSubTitle field
        // The format of this string should be the same as the one on the
        // MediaManager.getRecordSubTitle method
        if (mediaRecord?.kind === MediaKind.TvEpisode) {
            const seasonNumber = mediaRecord.seasonNumber.toString().padStart(2, '0');
            const episodeNumber = mediaRecord.number.toString().padStart(2, '0');

            historyRecord.mediaSubTitle = `${mediaRecord.showTitle} S${seasonNumber}E${episodeNumber}`;
        }
    }
}

function getTableNameForKind(kind: MediaKind): string {
    switch ( kind ) {
        case MediaKind.Movie: return 'mediaMovies';
        case MediaKind.TvShow: return 'mediaTvShows';
        case MediaKind.TvSeason: return 'mediaTvSeasons';
        case MediaKind.TvEpisode: return 'mediaTvEpisodes';
        case MediaKind.Custom: return 'mediaCustom';
        default: throw new Error( `Unknown media kind ${ kind }` );
    }
}
