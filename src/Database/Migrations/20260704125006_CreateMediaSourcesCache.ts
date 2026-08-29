import type { Knex } from 'knex';
import { AllMediaKinds } from '../../MediaRecord';

export async function up ( knex : Knex ) : Promise<void> {
    await knex.schema.createTable( 'mediaSourcesCache', table => {
        table.increments( 'id' );
        table.integer( 'mediaId' );
        table.enum( 'mediaKind', AllMediaKinds );
        table.string( 'state' ).checkIn( [ 'queued', 'copying', 'ready', 'failed', 'paused' ] ).notNullable();
        table.json( 'sources' ).nullable();
        table.string( 'error' ).nullable();
        table.datetime( 'lastAttemptAt' ).nullable();
        table.timestamps( /* useTimestamps */ false, /* defaultToNow */ false, /* useCamelCase */ true );

        table.foreign( [ 'mediaId', 'mediaKind' ] ).references( [ 'id', 'kind' ] ).inTable( 'media' ).onDelete( 'CASCADE' ).onUpdate( 'CASCADE' );
        table.unique( [ 'mediaId', 'mediaKind' ] );
        table.index( 'state' );
    } );
}

export async function down ( knex : Knex ) : Promise<void> {
    await knex.schema.dropTableIfExists( 'mediaSourcesCache' );
}