import { Database, MediaTable } from "./Database/Database";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { MediaKind, AllMediaKinds, MediaRecord, PlayableMediaRecord, createRecordsSet, RecordsSet, createRecordsMap, RecordsMap, MediaCastRecord, PersonRecord, RoleRecord, isTvEpisodeRecord, isMovieRecord } from "./MediaRecord";
import { BackgroundTask } from "./BackgroundTask";
import { MediaManager } from "./UnicastServer";
import { Future } from "@pedromsilva/data-future";
import { IMediaRepository } from "./MediaRepositories/MediaRepository";
import { CacheOptions } from './MediaScrapers/ScraperCache';
import { SharedLogger, Logger } from 'clui-logger';
import { MediaRecordFilter, TvMediaFilter, MediaSetFilter } from './MediaRepositories/ScanConditions';
import { ScrapersManager } from './MediaScrapers/ScrapersManager';
import { collect, groupingBy, first, mapping, distinct, filtering } from 'data-collectors';
import { ProvidersController } from './Controllers/ApiControllers/MediaControllers/ProvidersController';
import { AsyncStream } from 'data-async-iterators';
import { SemaphorePool } from 'data-semaphore';

export interface MediaSyncOptions {
    repositories : string[];
    kinds : MediaKind[];
    cleanMissing : boolean;
    refetchExisting : boolean;
    refetchIncomplete : boolean;
    updateMoved : boolean;
    dryRun : boolean;
    cache ?: CacheOptions;
}

export class MediaSync {
    media : MediaManager;

    database : Database;

    repositories : RepositoriesManager;

    scrapers : ScrapersManager;

    logger : Logger;

    /** Prevents multiple movies/tv shows with the same person that might be updating their cast concurrently to change the same person at the same time */
    protected castPersonLock : SemaphorePool<string> = new SemaphorePool( 1, true );
    
    constructor ( media : MediaManager, db : Database, repositories : RepositoriesManager, scrapers : ScrapersManager, logger : SharedLogger ) {
        this.media = media;
        this.database = db;
        this.repositories = repositories;
        this.scrapers = scrapers;
        this.logger = logger.service( 'media/sync' );
    }

    print ( record : MediaRecord ) : string {
        if ( isTvEpisodeRecord( record ) ) {
            return record.title + ' ' + ( record as PlayableMediaRecord ).sources[ 0 ].id;
        } else if ( isMovieRecord( record ) ) {
            return `${ record.title } (${ record.year }) ${ record.sources[ 0 ].id }`;
        } else {
            return record.title;
        }
    }

    async runRecordForeigns ( table : MediaTable<any>, media : MediaRecord, snapshot : MediaSyncSnapshot ) {
        for ( let property of Object.keys( table.foreignMediaKeys ) ) {
            if ( media[ property ] ) {
                const kind = table.foreignMediaKeys[ property ];

                media[ property ] = await snapshot.association.get( kind ).get( media[ property ] ).promise;
            }
        }
    }

    /**
     * 
     * 
     * @param task 
     * @param media 
     * @param snapshot 
     */
    async runRecord ( task : BackgroundTask, media : MediaRecord, snapshot : MediaSyncSnapshot, cache ?: CacheOptions ) {
        // !! IMPORTANT !! This function must always, at some point, call snapshot.scanBarrier.ready();
        snapshot.scanBarrier.increase();

        const table = this.media.getTable( media.kind );

        // When the touched RecordsSet contains an item, we don't need to update it on the database
        // Instead, we just set the association and check the touched, so that the item is not wrongly removed
        if ( snapshot.recordsToIgnore.get( media.kind ).has( media.internalId ) ) {
            // The media object is the one generated from the database, but it has the id removed and was funneled through the repository
            // As such, to obtain it's id we need to access the object stored in the `ignore` RecordsMap
            const match = snapshot.recordsToIgnore.get( media.kind ).get( media.internalId );

            snapshot.association.get( media.kind ).set( media.internalId, Future.resolve( match.id ) );

            snapshot.touched.get( media.kind ).add( match.id );

            snapshot.scanBarrier.ready();

            return;
        }

        const future = new Future<string>();

        // When creating a new media record, for instance, a new Tv Show, we store it on the association map.
        // So if after that we create a new media record for, say, a season of that same Tv show, we can know it's id
        // Since the insertion of records into the database is done concurrently, we might try to insert both the Tv show 
        // and the season at the same time. But doing that would result in an error, since we don't have the Tv show id yet
        // That's why we store the promise even before inserting the record, so any future media that needs it, can just wait for it
        snapshot.association.get( media.kind ).set( media.internalId, future );

        // WARNING MUST BE BEFORE ANY AWAIT
        snapshot.touched.get( media.kind ).add( media.internalId );

        let match = ( await table.findAll( [ media.internalId ], { index: 'internalId', query : query => query.filter( { repository: media.repository } ).limit( 1 ) } ) ) [ 0 ]

        if ( match ) {
            snapshot.scanBarrier.ready();

            future.resolve( match.id );

            await this.runRecordForeigns( table, media, snapshot );

            await this.updateRecord( task, match, media, snapshot.options.dryRun, cache );
        } else {
            const existingMatch = snapshot.getAnyExternal( media.external );
            
            if ( existingMatch != null && snapshot.options.updateMoved ) {
                snapshot.duplicated.push( media );

                snapshot.scanBarrier.ready();
            } else {
                snapshot.scanBarrier.ready();

                await this.runRecordForeigns( table, media, snapshot );

                match = await this.createRecord( task, media, snapshot.options.dryRun );
    
                future.resolve( match.id );
            }
        }
    }

    async runDuplicate ( task : BackgroundTask, media : MediaRecord, snapshot : MediaSyncSnapshot ) {
        const table = this.media.getTable( media.kind );

        await this.runRecordForeigns( table, media, snapshot );

        media = await this.createRecord( task, media, snapshot.options.dryRun );

        snapshot.association.get( media.kind ).get( media.internalId ).resolve( media.id );
    }

    async createRecord ( task : BackgroundTask, media : MediaRecord, dryRun : boolean = false, cache ?: CacheOptions ) : Promise<MediaRecord> {
        // Create
        if ( !dryRun ) {
            const table = this.media.getTable( media.kind );

            const now = new Date();

            media = await table.create( {
                ...table.baseline,
                ...media as any,
                createdAt: now,
                updatedAt: now
            }, { durability: 'soft' } );
        } else {
            media.id = media.internalId;
        }

        this.logger.info( 'CREATE ' + this.print( media ) );
        
        await this.runCast( media, dryRun, cache );
        
        return media;
    }

    async updateRecord ( task : BackgroundTask, oldRecord : MediaRecord, newRecord : MediaRecord, dryRun : boolean = false, cache ?: CacheOptions ) {
        const table = this.media.getTable( newRecord.kind );
        
        newRecord = { ...newRecord };
        
        for ( let property of Object.keys( table.foreignMediaKeys ) ) {
            delete newRecord[ property ];
        }

        for ( let key of Object.keys( table.baseline ) ) {
            delete newRecord[ key ];
        }

        if ( !dryRun ) newRecord = await table.updateIfChanged( oldRecord, newRecord, { updatedAt: new Date() }, { durability: 'soft' } );
            
        if ( table.isChanged( oldRecord, newRecord ) ) this.logger.info( 'UPDATE ' + oldRecord.id + ' ' + this.print( newRecord ) + ' ' + JSON.stringify( table.getLocalChanges( oldRecord, newRecord ) ) );

        await this.runCast( newRecord, dryRun, cache );
    }

    async moveRecord ( task : BackgroundTask, oldRecord : MediaRecord, newRecord : MediaRecord, dryRun : boolean = false ) {
        this.logger.info( 'MOVE ' + oldRecord.id + ' ' + this.print( oldRecord ) + ' ' + newRecord.id + ' ' + this.print( newRecord ) );
        await this.updateRecord( task, oldRecord, newRecord, dryRun );
    }

    async deleteRecord ( task : BackgroundTask, record : MediaRecord, dryRun : boolean = false ) {
        if ( !dryRun ) {
            const table = this.media.getTable( record.kind );

            await table.delete( record.id, { durability: 'soft' } );
        }

        this.logger.info( 'DELETE ' + record.id + ' ' + this.print( record ) );
    }

    async runCast<R extends MediaRecord> ( media : R, dryRun : boolean = false, cache ?: CacheOptions ) {
        let existingPeopleCount = 0;
        
        let createdPeopleCount = 0;

        const peopleTable = this.database.tables.people;

        const table = this.media.getTable( media.kind );

        if ( !media.scraper ) {
            this.logger.error( `[${ media.kind } ${this.print( media )}] Has no scraper defined. Could not get cast.` );

            return;
        }
        
        if ( !this.scrapers.hasKeyed( media.scraper ) ) {
            this.logger.error( `[${ media.kind } ${this.print( media )}] Could not find scraper "${ media.scraper }". Could not get cast.` );

            return;
        }

        // We get the scraper media record associated with our local `media` record (using the external object)
        // We do this so we can then get the record's internal scraper id to get the cast
        const scraperMedia = await this.scrapers.getMediaExternal( media.scraper, media.kind, media.external, cache );

        if ( !scraperMedia ) {
            this.logger.error( `[${ media.kind } ${this.print( media )}] No external media found for ${ JSON.stringify( media.external ) }. Could not get cast.` );

            return;
        }

        // A list of RoleRecord from the scraper
        const newRoles : RoleRecord[] = await this.scrapers.getMediaCast( media.scraper, media.kind, scraperMedia.id, cache );

        // A map associating the internal id (meaning, the id from the scraper)
        // and the existing person record in the local database
        // The role that associates the person and the media is accessible
        // via the `.cast` property on each PersonRecord
        const existingRoles : Map<string, PersonRecord> = collect( 
            await table.relations.cast.load( media ),
            groupingBy( role => role.cast.internalId, first() )
        );

        // This will contain the internalIds of the new roles that don't
        // have anyone on the database associated with them for this media record
        const newPeopleRolesId = newRoles.map( role => role.internalId ).filter( id => id && !existingRoles.has( id ) );

        // And we will search OTHER media records for the same person and see what we find
        const newPeopleRoles : MediaCastRecord[] = collect( 
            await this.database.tables.mediaCast.findAll( newPeopleRolesId, { index: 'internalId' } ), 
            filtering( p => p.personId != null, distinct( p => p.internalId ) )
        );

        // Load the people related to those records
        await this.database.tables.mediaCast.relations.person.applyAll( newPeopleRoles );

        const newPeople = collect( 
            newPeopleRoles,
            filtering( role => role.person != null, groupingBy( role => role.internalId, mapping( person => ( {
                ...person.person,
                cast: person
            } ), first<PersonRecord>() ) ) )
        );
        
        // We will iterate over the new roles we found to check if they are already present
        // on the database or if they are new. 
        // When we find one that is already in  the database, we remove it so that in the end
        // we can check which ones are stale (exist in the local database but not in scraper anymore)
        await new AsyncStream( newRoles ).parallel( async role => {
            await this.castPersonLock.acquire( role.internalId );

            try {
                let person : PersonRecord = null;
            
                const matchRole = existingRoles.get( role.internalId );
    
                if ( matchRole != null ) {
                    existingRoles.delete( role.internalId );
    
                    person = matchRole;
                }
    
                // Just because there was no match found for this person on the database
                // as being part of the cast, the person's record might already exist 
                // (associated to other media records) and as such we should reuse it
                if ( person == null ) {
                    person = newPeople.get( role.internalId );
                }
    
                if ( person != null ) {
                    if ( !dryRun ) {
                        person = await peopleTable.updateIfChanged( person, {
                            name: role.name,
                            biography: role.biography || person.biography,
                            birthday: role.birthday || person.birthday,
                            deathday: role.deathday || person.deathday,
                            naturalFrom: role.naturalFrom || person.naturalFrom,
                            art: role.art || person.art
                        }, null, { durability: 'soft' } );
                    }
    
                    existingPeopleCount++;
                } else {
                    person = {
                        art: role.art,
                        biography: role.biography,
                        birthday: role.birthday,
                        deathday: role.deathday,
                        name: role.name,
                        naturalFrom: role.naturalFrom
                    };
    
                    if ( !dryRun ) {
                        person = await peopleTable.create( person, { durability: 'soft' } );
                    }
    
                    createdPeopleCount++;
                }
    
                const cast : Partial<MediaCastRecord> = {
                    internalId: role.internalId,
                    external: {},
                    mediaId: media.id,
                    mediaKind: media.kind,
                    order: role.order,
                    role: role.role,
                    scraper: media.scraper,
                    personId: person.id,
                };

                if ( !dryRun ) {
                    if ( matchRole != null ) {
                        await this.database.tables.mediaCast.updateIfChanged( matchRole.cast, cast, {
                            updatedAt: new Date()
                        }, { durability: 'soft' } );
                    } else {
                        await this.database.tables.mediaCast.create( {
                            ...cast as any,
                            updatedAt: new Date(),
                            createdAt: new Date(),
                        }, { durability: 'soft' } );
                    }
                }
            } finally {
                this.castPersonLock.release( role.internalId );
            }
        }, 100 ).last();

        // When updating the roles in the loop above, we remove from the `existingRoles` map
        // all roles that already exist in the database. As such, whatever is left is stale data that
        // has been removed from the remote database and as such we should sync that up
        // by removing them in our database as well
        const toBeRemovedIds = Array.from( existingRoles.values() ).map( role => role.id );

        const deletedCastCount = await this.database.tables.mediaCast.deleteKeys( toBeRemovedIds );

        return { createdPeopleCount, existingPeopleCount, deletedCastCount };
    }

    async findRepositoryRecordsMap ( repository : IMediaRepository ) : Promise<RecordsMap<MediaRecord>> {
        const recordsSet = createRecordsMap<MediaRecord>();

        for ( let [ kind, set ] of recordsSet ) {
            const table = this.media.getTable( kind );

            if ( table ) {
                const allRecords = table.findStream( query => query.filter( { repository: repository.name } ) );
                
                for await ( let record of allRecords ) {
                    set.set( record.internalId, record );
                }
            }
        }

        return recordsSet;
    }

    async findIncompleteRecords ( repository : IMediaRepository ) : Promise<MediaRecordFilter[]> {
        const episodes = await this.database.tables.episodes.findStream( query => query.filter( { repository: repository.name } ) )
            .filter( ep => ep.art.thumbnail == null || ep.plot == null )
            .toArray();

        const seasons = await this.database.tables.seasons.findStream( query => query.filter( { repository: repository.name } ) )
            .filter( ep => ep.art.poster == null )
            .toArray();

        return [ await MediaSetFilter.list( [...episodes, ...seasons], this.media ) ];
    }

    async run ( task : BackgroundTask = null, options : Partial<MediaSyncOptions> = {} ) : Promise<void> {
        task = task || new BackgroundTask();

        task.setStateStart();

        options = { ...options };

        if ( !( 'repositories' in options ) ) options.repositories = Array.from( this.repositories.keys() );

        if ( !( 'kinds' in options ) ) options.kinds = AllMediaKinds;

        task.addTotal( options.cleanMissing ? 2 : 1 );

        for ( let repositoryName of options.repositories ) {
            const repository = this.repositories.get( repositoryName );

            let updating : Promise<void>[] = [];

            if ( repository.indexable ) {
                const snapshot = await MediaSyncSnapshot.from( this.media, options, repository.name );
                
                // Allows setting up special conditions for refreshing particular media records
                const conditions : MediaRecordFilter[] = options.refetchIncomplete
                    ? await this.findIncompleteRecords( repository )
                    : [];

                snapshot.scanBarrier.freeze();

                const logger = this.logger.service( repository.name );

                for await ( let media of repository.scan( options.kinds, snapshot, conditions, options.cache || {}, logger ) ) {
                    task.addTotal( 1 );
                    
                    media = { ...media };
                    
                    media.internalId = media.id;
                    delete media.id;
                    
                    media.repository = repositoryName;
                    
                    updating.push(
                        task.do(
                            this.runRecord( task, media, snapshot, options.cache || {} ), 
                        1 )
                    );
                }
                
                snapshot.scanBarrier.unfreeze();

                await snapshot.scanBarrier.block();

                if ( options.cleanMissing || options.updateMoved ) {
                    const deleting : Promise<void>[] = [];
                    const moving : Promise<void>[] = [];
    
                    // We must iterate over the records loaded into memory before the sync started
                    // because we're not awaiting for all records to be stored inside, since
                    // we need to check if they are to be removed first (to allow updateMoved)
                    for ( let kind of snapshot.records.keys() ) {
                        for ( let record of snapshot.records.get( kind ).values() ) {
                            if ( !snapshot.touched.get( record.kind ).has( record.id ) ) {
                                if ( repository.ignoreUnreachableMedia && !await repository.isMediaReachable( record ) ) {
                                    continue;
                                }

                                task.addTotal( 1 );

                                const duplicate = snapshot.popDuplicated( record );

                                if ( options.updateMoved && duplicate != null ) {
                                    snapshot.association.get( record.kind ).get( duplicate.internalId ).resolve( record.id );

                                    moving.push( task.do( this.moveRecord( task, record, duplicate, snapshot.options.dryRun ), 1 ) );
                                } else if ( options.cleanMissing ) {
                                    deleting.push( task.do( this.deleteRecord( task, record, options.dryRun ), 1 ) );
                                }
                            }
                        }
                    }

                    for ( let record of snapshot.duplicated ) {
                        updating.push( 
                            task.do(
                                this.runDuplicate( task, record, snapshot ), 
                            1 )
                        );
                    }

                    await task.do( Promise.all( updating ), 1 );
    
                    await task.do( Promise.all( deleting ), 1 );
                }

                task.setStateFinish();
            }
        }
    }
}

export class MediaSyncSnapshot {
    public repository : string;

    public options : Partial<MediaSyncOptions>;

    public scanBarrier : Barrier;

    public records : RecordsMap<MediaRecord>;

    /**
     * 
     */
    public association : RecordsMap<Future<string>>;

    /**
     * A set of all records that were found during the synchronization process (indexed by the tuple (MediaKing, Id))
     */
    public touched : RecordsSet;

    /**
     * When the `options.refetchExisting` option is set to false, media records that are already on the database are not scraped
     * But for that it is necessary to know which records exist in the database
     * So instead of querying the database each time for each record found, we'll just store all of them in this Records Map
     * When the `options.refetchExisting``is true, we just provide an empty Record Map, so that all records are refetched
     */
    public recordsToIgnore : RecordsMap<MediaRecord>;

    /**
     * When a new media record is found that represents the same media (same external keys) as some other
     * media record already stored in the database, the new record is not saved immediately.
     * Instead, it is temporarily saved in this array. Then, if before the sync process ends, a matching
     * media record (same external keys) is found to have been deleted, instead of removing that record from
     * the database, and creating a new one, a replacement happens.
     * 
     * A replacement refers to the act of keeping the unique ID that identifies that media record, as well as
     * any relations it might have, while updating other info (such as the sources of the media record) with
     * the data from the new media record.
     * 
     * Obviously, any new duplicated media records that don't have any matching deleted records, are inserted
     * as regular new media records into the database.
     */
    public duplicated : MediaRecord[];

    /**
     * This variable will hold all media records stored in the database, indexed by their external keys.
     */
    public externals : Map<string, Map<string, MediaRecord[]>> = new Map();

    public constructor ( options : Partial<MediaSyncOptions>, repository : string ) {
        this.options = options;
        this.repository = repository;
    }

    protected static async createRecordsMap ( media : MediaManager, repository : string ) {
        const recordsSet = createRecordsMap<MediaRecord>();

        for ( let [ kind, set ] of recordsSet ) {
            const table = media.getTable( kind );

            if ( table ) {
                const allRecords = table.findStream( query => query.filter( { repository: repository } ) );
                
                for await ( let record of allRecords ) {
                    set.set( record.internalId, record );
                }
            }
        }

        return recordsSet;
    }

    
    public addExternal ( type : string, id : string, media : MediaRecord ) {
        let dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            dictionary = new Map();
            
            this.externals.set( type, dictionary );
        }

        const array = dictionary.get( id );

        if ( array == null ) {
            dictionary.set( id, [ media ] );
        } else {
            array.push( media );
        }
    }

    public hasExternal ( type : string, id : string ) : boolean {
        const dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            return false;
        }

        const array = dictionary.get( id );

        return array != null && array.length > 0;
    }

    public getExternal ( type : string, id : string ) : MediaRecord[] {
        const dictionary = this.externals.get( type );

        if ( dictionary == null ) {
            return null;
        }

        return dictionary.get( id );
    }

    public addAllExternal ( external : any, record : MediaRecord ) {
        for ( let key of Object.keys( external ) ) {
            if ( external[ key ] ) {
                this.addExternal( key, external[ key ], record );
            }
        }
    }

    public getAnyExternal ( external : any ) : MediaRecord {
        for ( let key of Object.keys( external ) ) {
            const records = this.getExternal( key, external[ key ] );

            if ( records && records.length > 0 ) {
                return records[ 0 ];
            }
        }
    }

    public deleteExternalRecord ( record : MediaRecord ) {
        for ( let key of Object.keys( record.external ) ) {
            if ( record[ key ] != null ) {
                const dictionary = this.externals.get( key );

                if ( dictionary != null ) {
                    let matched = dictionary.get( record.external[ key ] );

                    if ( matched != null ) {
                        if ( matched.length == 1 && matched[ 0 ].id == record.id ) {
                            dictionary.delete( record.external[ key ] );
                        } else if ( matched.length > 1 ) {
                            matched = matched.filter( r => r.id != record.id );

                            if ( matched.length == 0 ) {
                                dictionary.delete( record.external[ key ] );
                            } else {
                                dictionary.set( record.external[ key ], matched );
                            }
                        }
                    }
                }
            }
        }
    }

    public popDuplicated ( record : MediaRecord ) : MediaRecord {
        const ext = record.external;

        const extKeys = Object.keys( ext ).filter( key => ext[ key ] != null );

        let index = this.duplicated.findIndex( dup => dup.kind == record.kind && extKeys.some( key => ext[ key ] == dup.external[ key ] ) );

        if ( index >= 0 ) {
            return this.duplicated.splice( index, 1 )[ 0 ];
        }

        return null;
    }

    public static async from ( media : MediaManager, options : Partial<MediaSyncOptions>, repository : string ) : Promise<MediaSyncSnapshot> {
        const snapshot = new MediaSyncSnapshot( options, repository );

        snapshot.scanBarrier = new Barrier();

        snapshot.records = await MediaSyncSnapshot.createRecordsMap( media, repository );

        snapshot.recordsToIgnore = options.refetchExisting
            ? createRecordsMap()
            : snapshot.records;

        snapshot.association = createRecordsMap<Future<string>>();

        snapshot.touched = createRecordsSet();

        snapshot.duplicated = [];

        for ( let map of snapshot.records.values() ) {
            for ( let record of map.values() ) {
                snapshot.addAllExternal( record.external, record );
            }
        }

        return snapshot;
    }
}

export class Barrier {
    protected _readyCount : number = 0;

    protected _totalCount : number = 0;

    protected future : Future<void> = new Future();

    public froozen : boolean = false;

    public get readyCount () {
        return this._readyCount;
    }
    
    public get totalCount () {
        return this._totalCount;
    }

    protected flush () {
        if ( !this.froozen && this._totalCount <= this._readyCount ) {
            this.future.resolve();
        }
    }

    public block () {
        return this.future.promise;
    }

    public ready () {
        this._readyCount++;

        this.flush();
    }

    public increase () {
        this._totalCount++;

        this.flush();
    }

    public freeze () {
        this.froozen = true;
    }
    
    public unfreeze () {
        this.froozen = false;

        this.flush();
    }
}