// noinspection DuplicatedCode

import type {Knex} from 'knex';
import {AllMediaKinds} from '../../MediaRecord';
import {chunk} from '../Tables/BaseTable';
import {collect, filtering, groupingBy, distinct, mapping} from "data-collectors";
import {PersonRecord} from "../../MediaRecord";
import {PersonRecordSql} from "../Tables/PeopleTable";
import * as sortBy from 'sort-by';

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
    const dryRun = false;

    let rows: PersonCastRow[] = await knex.table('people')
        .leftJoin('mediaCast', 'mediaCast.personId', '=', 'people.id')
        .select(
            'people.id AS id',
            'people.art AS art',
            'people.biography AS biography',
            'people.birthday AS birthday',
            'people.deathday AS deathday',
            'people.identifier AS identifier',
            'people.name AS name',
            'people.naturalFrom AS naturalFrom',
            'people.identifier AS identifier',

            'mediaCast.id AS castId',
            'mediaCast.appearences AS appearences',
            'mediaCast.scraper AS scraper',
            'mediaCast.external AS external',
            'mediaCast.internalId AS internalId',
            'mediaCast.createdAt AS createdAt',
            'mediaCast.updatedAt AS updatedAt',
        );

    await knex.schema.alterTable('mediaCast', table => {
        return table.dropForeign('personId');
    });

    await alterTable(knex, 'people', table => {
        table.increments('id');
        table.json('external');
        table.string('internalId');
        table.string('scraper').nullable();
        table.json('art');
        table.text('biography').nullable();
        table.datetime('birthday').nullable();
        table.datetime('deathday').nullable();
        table.string('identifier');
        table.string('name');
        table.string('naturalFrom').nullable();
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);
    }, row => {
        return row;
    });

    await alterTable(knex, 'mediaCast', table => {
        table.increments('id');
        // table.json('external');                   // REMOVED COLUMN <-----
        // table.string('internalId');               // REMOVED COLUMN <-----
        table.integer('mediaId');
        table.enum('mediaKind', AllMediaKinds);
        table.integer('order');
        table.integer('personId');
        table.string('role');
        // table.integer('appeare');                 // REMOVED COLUMN <-----
        // table.integer('appearences').nullable();  // REMOVED COLUMN <-----
        table.integer('appearances').nullable();     // NEW COLUMN <-----
        // table.string('scraper').nullable();       // REMOVED COLUMN <-----
        table.timestamps(/* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true);

        table.foreign(['mediaId', 'mediaKind']).references(['id', 'kind']).inTable('media').onDelete('CASCADE').onUpdate('CASCADE');
        table.foreign('personId').references('id').inTable('people').onDelete('CASCADE').onUpdate('CASCADE');

        table.dropIndex('personId');
        table.index('personId');
        table.dropIndex(['mediaId', 'mediaKind']);
        table.index(['mediaId', 'mediaKind']);
    }, row => {
        // NOTE the "ranc" vs "renc" typo is corrected
        row.appearances = row.appearences
        delete row.appearences;
        delete row.appeare;
        delete row.internalId;
        delete row.external;
        delete row.scraper;
        return row;
    });

    //# region Migrate data

    // Group all records by their (scraper, internalId)
    let peopleByInternalId = collect(rows,
        filtering(row => row.castId != null,
            groupingBy(row => row.scraper,
                groupingBy(row => row.internalId))));

    const results: PersonCastResult[] = [];

    for (const rowsGroup of peopleByInternalId.get('moviedb').values()) {
        const oldest = rowsGroup.reduce((min, row) => min == null || row.createdAt < min.createdAt ? row : min, null);
        const newest = rowsGroup.reduce((max, row) => max == null || row.updatedAt > max.updatedAt ? row : max, null);

        const person = {
            id: oldest.id,
            name: newest.name,
            identifier: newest.identifier,
            scraper: newest.scraper,
            // There seems to have been some error with internalIds that had a ".0" appended to them
            // so we will remove them here
            internalId: oldest.internalId.split('.')[0],
            external: newest.external,
            art: newest.art,
            biography: newest.biography,
            birthday: newest.birthday,
            deathday: newest.deathday,
            naturalFrom: newest.naturalFrom,
            createdAt: oldest.createdAt,
            updatedAt: newest.updatedAt,
        };

        const mergedCastIds = collect(rowsGroup, filtering(row => row.id != person.id, mapping(row => row.castId, distinct<number>())));
        const mergedPeopleIds = collect(rowsGroup, filtering(row => row.id != person.id, mapping(row => row.id, distinct<number>())));

        results.push({person, mergedCastIds, mergedPeopleIds});

    }

    results.sort(sortBy('-mergedCastIds.length', '-mergedPeopleIds.length'));

    const peopleToDelete: number[] = [];

    for (const {person, mergedCastIds, mergedPeopleIds} of results) {
        if (!dryRun) {
            await knex.table('people').where('id', '=', person.id).update(person);
        }

        if (mergedCastIds.length > 0) {
            if (!dryRun) {
                await knex.table('mediaCast').whereIn('id', mergedCastIds).update({
                    personId: person.id
                });
            }
        }

        peopleToDelete.push(...mergedPeopleIds);
    }

    // Also, take the chance and delete any people records without a media cast
    let peopleWithoutMedia = collect(rows, filtering(row => row.castId == null, mapping(row => row.id)));
    peopleToDelete.push(...peopleWithoutMedia);

    if (peopleToDelete.length > 0) {
        if (!dryRun) {
            await knex.table('people').whereIn('id', peopleToDelete).del();
        }
    }

    //# endregion Migrate data
}

export async function down(knex: Knex): Promise<void> {
    // No undo here
}


export interface PersonCastRow {
    // People
    id: number;
    art: any;
    biography: string;
    birthday: number | null;
    deathday: number | null
    identifier: string;
    name: string;
    naturalFrom: string;

    // Cast
    castId: number | null;
    appearences: number | null;
    scraper: string;
    external: any;
    internalId: string;
    createdAt: number;
    updatedAt: number;
}

export interface PersonCastResult {
    person: Omit<PersonRecord, keyof PersonRecordSql> & PersonRecordSql;
    mergedPeopleIds: number[];
    mergedCastIds: number[];
}
