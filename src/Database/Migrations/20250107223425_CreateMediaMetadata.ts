import type { Knex } from 'knex';
import { AllMediaKinds, MediaKind } from '../../MediaRecord';
import { collect, distinct, first, groupingBy, mapping } from 'data-collectors';
import { chunk } from '../Tables/BaseTable';

export async function migrateTable<T, T2>(knex: Knex, oldTableName: string, newTableName: string, transformer: (row: T) => T2) {
    let rows = await knex.table(oldTableName).select();
    rows = rows.map(transformer);

    const chunkSize = Math.floor(500 / (Object.keys(rows[0]).length));

    for (const chunkRows of chunk(rows, chunkSize)) {
        await knex.table(newTableName).insert(chunkRows);
    }
}

export async function alterTable(knex: Knex, tableName: string, callback: (tableBuilder: Knex.CreateTableBuilder) => any, transform?: (row: any) => any) {
    // 1. Rename the current table
    await knex.schema.renameTable(tableName, tableName + '_old');
    // 2. Create the table with the new schema
    await knex.schema.createTable(tableName, callback);
    // 3. Migrate the data
    await migrateTable(knex, tableName + '_old', tableName, transform ?? (a => a));
    // 4. Drop the old schema table
    await knex.schema.dropTableIfExists(tableName + '_old');
    // 5. Make the old foreign key references point to the new table with this trick
    await knex.schema.renameTable(tableName, tableName + '_old');
    await knex.schema.renameTable(tableName + '_old', tableName);
}

export async function up(knex: Knex): Promise<void> {
    await alterTable(knex, 'mediaCustom', table => {
        table.integer('id');
        table.string('kind').checkIn([MediaKind.Custom]);
        table.string('internalId');
        table.json('art');
        table.json('external');
        table.datetime('lastPlayedAt').nullable();
        table.json('lastPlayedAtLegacy');
        table.integer('runtime').nullable();
        table.string('scraper');
        table.json('sources');
        table.json('metadata').nullable().defaultTo(null); // NEW COLUMN <-----
        table.integer('playCount');
        table.text('plot');
        // table.json('quality');                          // REMOVED COLUMN <-----
        table.string('repository').nullable();
        table.json('repositoryPaths');
        table.string('subtitle').nullable();
        table.string('title');
        table.boolean('watched').defaultTo(false);
        table.boolean('transient').defaultTo(false);
        table.datetime('addedAt');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.primary(['id', 'kind']);
        table.foreign(['id', 'kind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');

        table.dropUnique(['internalId']); table.unique('internalId');
        table.dropIndex('lastPlayedAt'); table.index('lastPlayedAt');
        table.dropIndex('addedAt'); table.index('addedAt');
    });

    await alterTable(knex, 'mediaMovies', table => {
        table.integer('id');
        table.string('kind').checkIn([MediaKind.Movie]);
        table.string('internalId');
        table.json('art');
        table.json('external');
        table.json('genres');
        table.integer('playCount').defaultTo(0);
        table.datetime('lastPlayedAt').nullable();
        table.json('lastPlayedAtLegacy');
        table.string('parentalRating').nullable();
        table.text('plot');
        // table.json('quality');                          // REMOVED COLUMN <-----
        table.float('rating').nullable();
        table.string('repository');
        table.json('repositoryPaths');
        table.integer('runtime').nullable();
        table.string('scraper');
        table.json('sources');
        table.json('metadata').nullable().defaultTo(null); // NEW COLUMN <-----
        table.string('tagline').nullable();
        table.string('title');
        table.string('trailer').nullable();
        table.boolean('watched').defaultTo(false);
        table.integer('year');
        table.boolean('transient').defaultTo(false);
        table.datetime('addedAt');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.primary(['id', 'kind']);
        table.foreign(['id', 'kind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');

        table.dropUnique(['internalId']); table.unique('internalId');
        table.dropIndex('title'); table.index('title');
        table.dropIndex('addedAt'); table.index('addedAt');
        table.dropIndex('lastPlayedAt'); table.index('lastPlayedAt');
    },  row => {
        delete row.quality;
        return row;
    });

    await alterTable(knex, 'mediaTvEpisodes', table => {
        table.integer('id');
        table.string('kind').checkIn([MediaKind.TvEpisode]);
        table.string('internalId');
        table.json('art');
        table.json('external');
        table.datetime('lastPlayedAt').nullable();
        table.json('lastPlayedAtLegacy');
        table.integer('number');
        table.integer('playCount').defaultTo(0);
        table.text('plot').nullable();
        // table.json('quality');                           // REMOVED COLUMN <-----
        table.double('rating');
        table.string('repository');
        table.json('repositoryPaths');
        table.integer('runtime').nullable();
        table.string('scraper');
        table.integer('seasonNumber');
        table.json('sources');
        table.json('metadata').nullable().defaultTo(null);  // NEW COLUMN <-----
        table.string('title');
        table.boolean('transient').defaultTo(false);
        table.integer('tvSeasonId');
        table.string('tvSeasonKind').checkIn([MediaKind.TvSeason]);
        table.boolean('watched').defaultTo(false);
        table.datetime('airedAt').nullable();
        table.datetime('addedAt');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.primary(['id', 'kind']);
        table.foreign(['id', 'kind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign(['tvSeasonId', 'tvSeasonKind']).references(['id', 'kind']).inTable('mediaTvSeasons').onDelete('CASCADE').onUpdate('CASCADE');

        // We can skip the indexes because they already exist (???)
        table.dropUnique(['internalId']); table.unique('internalId');
        table.dropIndex('addedAt'); table.index('addedAt');
        table.dropIndex('lastPlayedAt'); table.index('lastPlayedAt');
    }, row => {
        delete row.quality;
        return row;
    });

    // Creates the new table that will store the raw results of probing the media (with FFMPEG)
    await knex.schema.createTable('mediaProbes', table => {
        table.integer('id');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.json('metadata');
        table.json('raw');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
    });
}

export async function down(knex: Knex): Promise<void> {
    // return knex.schema
    //     .dropTableIfExists('history')
    //     ;
}
