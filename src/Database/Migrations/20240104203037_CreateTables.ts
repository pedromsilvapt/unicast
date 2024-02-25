import type { Knex } from 'knex';
import { AllMediaKinds, MediaKind } from '../../MediaRecord';

export async function up(knex: Knex): Promise<void> {
    
    return knex.schema.createTable('collectionMedia', table => {
        table.increments('id');
        table.integer('collectionId');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.foreign('collectionId').references('id').inTable('collections').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        
        table.unique(['collectionId', 'mediaId']);
    }).createTable('collections', table => {
        table.increments('id');
        table.string('identifier');
        table.json('kinds');
        table.integer('parentId').nullable();
        table.string('title');
        table.string('color').nullable();
        table.boolean('primary').defaultTo(true);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.index('identifier');
        table.foreign('parentId').references('id').inTable('collections').onDelete('SET NULL').onUpdate('CASCADE');
    }).createTable('history', table => {
        table.increments('id');
        table.integer('playlistId').nullable();
        table.integer('playlistPosition').nullable();
        table.integer('position').nullable();
        table.json('positionHistory');
        table.string('receiver');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.json('transcoding').nullable();
        table.boolean('watched').defaultTo(false);
        table.string('importedFrom').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.foreign('playlistId').references('id').inTable('playlists').onDelete('SET NULL').onUpdate('CASCADE');
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
    }).createTable('jobQueue', table => {
        table.increments('id');
        table.string('action');
        table.json('payload');
        table.integer('priority');
        
        table.integer('pastAttempts').defaultTo(0);
        table.integer('maxAttempts');
        table.dateTime('nextAttempt').nullable();
        
        table.dateTime('attemptedAt').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
    }).createTable('mediaCast', table => {
        table.increments('id');
        table.json('external');
        table.string('internalId');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.integer('order');
        table.integer('personId');
        table.string('role');
        table.integer('appeare');
        table.integer('appearences').nullable();
        table.string('scraper').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign('personId').references('id').inTable('people').onDelete('CASCADE').onUpdate('CASCADE');
        
        table.index('personId');
        table.index(['mediaId', 'mediaKind']);
    }).createTable('media', table => {
        table.increments('id', { primaryKey: false });
        table.enum('kind', AllMediaKinds);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.unique('id');
        table.primary(['id', 'kind']);
    }).createTable('mediaCustom', table => {
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
        table.integer('playCount');
        table.text('plot');
        table.json('quality');
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
        
        table.unique('internalId');
        table.index('lastPlayedAt');
        table.index('addedAt');
    }).createTable('mediaMovies', table => {
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
        table.integer('palyCount').defaultTo(0);
        table.text('plot');
        table.json('quality');
        table.float('rating').nullable();
        table.string('repository');
        table.json('repositoryPaths');
        table.integer('runtime').nullable();
        table.string('scraper');
        table.json('sources');
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
        
        table.unique('internalId');
        table.index('title');
        table.index('addedAt');
        table.index('lastPlayedAt');
    }).createTable('mediaTvEpisodes', table => {
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
        table.json('quality');
        table.double('rating');
        table.string('repository');
        table.json('repositoryPaths');
        table.integer('runtime').nullable();
        table.string('scraper');
        table.integer('seasonNumber');
        table.json('sources');
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
        
        table.unique('internalId');
        table.index('addedAt');
        table.index('lastPlayedAt');
    }).createTable('mediaTvSeasons', table => {
        table.integer('id');
        table.string('internalId');
        table.string('kind').checkIn([MediaKind.TvSeason]);
        table.json('art');
        table.integer('episodesCount');
        table.json('external');
        table.datetime('lastPlayedAt').nullable();
        table.json('lastPlayedAtLegacy');
        table.integer('number');
        table.integer('playCount').defaultTo(0),
        table.string('repository');
        table.json('repositoryPaths');
        table.string('scraper');
        table.string('title');
        table.integer('tvShowId');
        table.string('tvShowKind').checkIn([MediaKind.TvShow]);
        table.string('tvShowInternalId');
        table.integer('watchedEpisodesCount');
        table.boolean('transient').defaultTo(false);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.primary(['id', 'kind']);
        table.foreign(['id', 'kind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign(['tvShowId', 'tvShowKind']).references(['id', 'kind']).inTable('mediaTvShows').onDelete('CASCADE').onUpdate('CASCADE');
        
        table.unique('internalId');
        table.index('lastPlayedAt');
    }).createTable('mediaTvShows', table => {
        table.integer('id');
        table.string('kind').checkIn([MediaKind.TvShow]);
        table.string('internalId');
        table.json('art');
        table.json('external');
        table.json('genres');
        table.datetime('lastPlayedAt').nullable();
        table.json('lastPlayedAtLegacy');
        table.string('parentalRating').nullable();
        table.integer('playCount').defaultTo(0);
        table.text('plot').nullable();
        table.float('rating').nullable();
        table.string('repository');
        table.json('repositoryPaths');
        table.string('scraper');
        table.integer('seasonsCount');
        table.integer('episodesCount');
        table.string('title');
        table.boolean('watched').defaultTo(false);
        table.integer('watchedEpisodesCount');
        table.integer('year');
        table.datetime('addedAt');
        table.boolean('transient').defaultTo(false);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.primary(['id', 'kind']);
        table.foreign(['id', 'kind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        
        table.unique('internalId');
        table.index('lastPlayedAt');
        table.index('addedAt');
    }).createTable('people', table => {
        table.increments('id');
        table.json('art');
        table.text('biography').nullable();
        table.datetime('birthday').nullable();
        table.datetime('deathday').nullable();
        table.string('identifier');
        table.string('name');
        table.string('naturalFrom').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
    }).createTable('playlists', table => {
        table.increments('id');
        table.string('device');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
    }).createTable('playlistMedia', table => {
        table.increments('id');
        table.integer('playlistId');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.integer('order').notNullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.foreign('playlistId').references('id').inTable('playlists').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
    }).createTable('storage', table => {
        table.increments('id');
        table.string('key');
        table.json('tags');
        table.json('value');
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
    }).createTable('subtitles', table => {
        table.increments('id');
        
        // ...
    }).createTable('userRanks', table => {
        table.increments('id');
        table.string('list');
        table.integer('position');
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
        
        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        table.unique(['list', 'mediaId']);
    });
}


export async function down(knex: Knex): Promise<void> {
    return knex.schema
        .dropTableIfExists('collectionMedia')
        .dropTableIfExists('collections')
        .dropTableIfExists('history')
        .dropTableIfExists('jobQueue')
        .dropTableIfExists('playlistMedia')
        .dropTableIfExists('playlists')
        .dropTableIfExists('subtitles')
        .dropTableIfExists('userRanks')
        .dropTableIfExists('mediaCast')
        .dropTableIfExists('mediaCustom')
        .dropTableIfExists('mediaMovies')
        .dropTableIfExists('mediaTvEpisodes')
        .dropTableIfExists('mediaTvSeasons')
        .dropTableIfExists('mediaTvShows')
        .dropTableIfExists('media')
        .dropTableIfExists('people')
        .dropTableIfExists('storage')
        ;
}
