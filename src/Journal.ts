import { UnicastServer } from './UnicastServer';
import { TransactionalLog, Transaction } from 'data-transactional-log';
import { ExternalReferences, MediaRecord, MediaKind, AllMediaKinds } from './MediaRecord';
import { AsyncIterableLike, AsyncStream } from 'data-async-iterators';
import { Hook, HookSubscription, HookSubscriptionCancellation } from './Hookable';
import { CollectionRecord, CollectionMediaRecord } from './Database/Database';
import * as r from 'rethinkdb';

export type JournalEntry = 
      { action: 'CREATE_COLLECTION', title: string }
    | { action: 'REMOVE_COLLECTION', title : string }
    | { action: 'ADD_TO_COLLECTION', collectionTitle : string, media : ExternalReferences }
    | { action: 'REMOVE_FROM_COLLECTION', collectionTitle : string, media : ExternalReferences }
    | { action: 'RATE_MEDIA', media : ExternalReferences, rating : number }
    | { action: 'CREATE_MEDIA', media : MediaRecord }
    | { action: 'UPDATE_MEDIA', media : MediaRecord }
    | { action: 'REMOVE_MEDIA', media : MediaRecord };

export interface JournalConfig {
    file ?: string;
}

export interface JournalAction {
    start ();

    stop ();

    rebuild () : AsyncIterable<[JournalEntry, number]>;
}

export class Journal {
    server : UnicastServer;

    file : string;

    log : TransactionalLog<JournalEntry>;

    actions : JournalAction[] = [];

    static fromServer ( server : UnicastServer ) : Journal {
        const config = {
            file: 'journal.json',
            ...server.config.get<JournalConfig>( 'journal', {} )
        };

        return new Journal( server, server.storage.getPath( config.file ) )
    }

    constructor ( server : UnicastServer, file : string ) {
        this.server = server;

        this.file = file;

        this.log = new TransactionalLog( file );

        this.actions.push( new CollectionsJournalAction( this ) );
        this.actions.push( new CollectionsMediaJournalAction( this ) );
        this.actions.push( new MediaJournalAction( this ) );

        // TODO RATE_MEDIA Action
    }

    start () : this {
        for ( let action of this.actions ) {
            action.start();
        }

        return this;
    }

    stop () : this {
        for ( let action of this.actions ) {
            action.stop();
        }

        return this;
    }

    createTransaction () : Promise<Transaction<JournalEntry>> {
        return this.log.transaction();
    }

    addEntry ( entry : JournalEntry ) : Promise<void> {
        return this.log.write( entry ).catch( error => this.server.onError.notify( error ) );
    }

    addEntries ( entries : AsyncIterableLike<JournalEntry> ) : Promise<void> {
        return this.log.writeTransaction( entries ).catch( error => this.server.onError.notify( error ) );
    }

    async clear () {
        // TODO
    }

    /**
     * Clears the existing journal, and queries the entire database to rebuild a compact version of it.
     * Returns an AsyncStream of any errors that happen during the execution
     */
    rebuild () : AsyncStream<any> {
        return AsyncStream.dynamic( async () => {
            await this.clear();

            return AsyncStream.from( this.actions )
                .flatMapSorted( action => action.rebuild(), ( a, b ) => a[ 1 ] - b[ 1 ] )
                .map( action => action[ 0 ] )
                .tap( action => this.addEntry( action ) )
                .dropValues()
                .takeErrors();
        }, true );
    }
}

export class JournalActionSubscription<T> {
    hook : Hook<T>;

    handler : HookSubscription<T>;

    protected subscription : HookSubscriptionCancellation;

    constructor ( hook : Hook<T>, handler : HookSubscription<T> ) {
        this.hook = hook;
        this.handler = handler;
    }

    start () {
        if ( this.subscription == null ) {
            this.subscription = this.hook.subscribe( this.handler );
        }
    }

    stop () {
        if ( this.subscription == null ) {
            this.subscription();
            
            this.subscription = null;
        }
    }
}

export abstract class BaseJournalAction implements JournalAction {
    protected subscriptionsList : JournalActionSubscription<unknown>[] = [];

    protected subscription <T> ( hook : Hook<T>, handler : HookSubscription<T> ) {
        this.subscriptionsList.push( new JournalActionSubscription( hook, handler ) );
    }

    start () {
        for ( let sub of this.subscriptionsList ) {
            sub.start();
        }
    }

    stop () {
        for ( let sub of this.subscriptionsList ) {
            sub.stop();
        }
    }

    abstract rebuild () : AsyncIterable<[ JournalEntry, number ]>;
}

export class CollectionsJournalAction extends BaseJournalAction {
    journal : Journal;

    constructor ( journal : Journal ) {
        super();

        this.journal = journal;

        const collections = this.journal.server.database.tables.collections;

        this.subscription( collections.onCreate, collection => this.journal.addEntry( { action: 'CREATE_COLLECTION', title: collection.title } ) );
        this.subscription( collections.onUpdate, collection => this.journal.addEntry( { action: 'REMOVE_COLLECTION', title: collection.title } ) );
    }

    createAction ( action : 'CREATE_COLLECTION' | 'REMOVE_COLLECTION', collection : CollectionRecord ) : JournalEntry {
        return { action: action as any, title: collection.title };
    }

    rebuild () : AsyncIterable<[JournalEntry, number]> {
        const collections = this.journal.server.database.tables.collections;

        return collections.findStream()
            .map( record => [ this.createAction( 'CREATE_COLLECTION', record ), 0 ] as [ JournalEntry, 0 ] );
    }
}

export class CollectionsMediaJournalAction extends BaseJournalAction {
    journal : Journal;
    
    constructor ( journal : Journal ) {
        super();

        this.journal = journal;

        const tables = this.journal.server.database.tables;

        const collectionsMedia = tables.collectionsMedia;

        this.subscription( collectionsMedia.onCreate, async rel => this.journal.addEntry( await this.createRecord( 'ADD_TO_COLLECTION', rel ) ) );
        this.subscription( collectionsMedia.onDelete, async rel => this.journal.addEntry( await this.createRecord( 'REMOVE_FROM_COLLECTION', rel ) ) );
    }

    async createRecord ( action : 'ADD_TO_COLLECTION' | 'REMOVE_FROM_COLLECTION', rel : CollectionMediaRecord ) : Promise<JournalEntry> {
        const tables = this.journal.server.database.tables;

        const collection = await tables.collections.get( rel.collectionId );
        const media = await this.journal.server.media.get( rel.mediaKind, rel.mediaId );

        return { action: action as any, media: media.external, collectionTitle: collection.title };
    }

    rebuild () : AsyncIterable<[JournalEntry, number]> {
        const collectionsMedia = this.journal.server.database.tables.collectionsMedia;

        return collectionsMedia.findStream( query => query.orderBy( { index: r.asc( 'createdAt' ) } ) )
            .map( async record => [ await this.createRecord( 'ADD_TO_COLLECTION', record ), record.createdAt.getTime() ] as [ JournalEntry, number ] );
    }
}

export class MediaJournalAction extends BaseJournalAction {
    journal : Journal;

    constructor ( journal : Journal ) {
        super();

        this.journal = journal;
        
        const tables = journal.server.database.tables;

        const mediaTables = [ tables.shows, tables.seasons, tables.episodes, tables.movies, tables.custom ];

        for ( let table of mediaTables ) {
            this.subscription( table.onCreate as Hook<MediaRecord>, record => this.journal.addEntry( { action: 'CREATE_MEDIA', media: record } ) );
            this.subscription( table.onUpdate as Hook<MediaRecord>, record => this.journal.addEntry( { action: 'UPDATE_MEDIA', media: record } ) );
            this.subscription( table.onDelete as Hook<MediaRecord>, record => this.journal.addEntry( { action: 'REMOVE_MEDIA', media: record } ) );
        }
    }

    rebuildKind ( kind : MediaKind ) : AsyncIterable<[JournalEntry, number]> {
        const table = this.journal.server.media.getTable( kind );

        return table.findStream( query => query.orderBy( { index: r.asc( 'addedAt' ) } ) );
    }

    rebuild () {
        return AsyncStream.from( AllMediaKinds )
            .flatMapSorted( kind => this.rebuildKind( kind ), ( a, b ) => a[ 1 ] - b[ 1 ] );
    }
}