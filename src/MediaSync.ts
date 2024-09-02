import { AbstractMediaTable, Database, MediaTable } from './Database/Database';
import { RepositoriesManager } from './MediaRepositories/RepositoriesManager';
import { MediaKind, AllMediaKinds, MediaRecord, PlayableMediaRecord, createRecordsSet, RecordsSet, createRecordsMap, RecordsMap, MediaCastRecord, PersonRecord, RoleRecord, isTvEpisodeRecord, isMovieRecord, isTvSeasonRecord, isTvShowRecord, isCustomRecord } from './MediaRecord';
import { BackgroundTask } from './BackgroundTask';
import { MediaManager, UnicastServer } from './UnicastServer';
import { Future } from '@pedromsilva/data-future';
import { IMediaRepository } from './MediaRepositories/MediaRepository';
import { CacheOptions } from './MediaScrapers/ScraperCache';
import { SharedLogger, Logger } from 'clui-logger';
import { MediaRecordFilter, TvMediaFilter, MediaSetFilter } from './MediaRepositories/ScanConditions';
import { ScrapersManager } from './MediaScrapers/ScrapersManager';
import { collect, groupingBy, first, mapping, distinct, filtering } from 'data-collectors';
import { AsyncStream } from 'data-async-iterators';
import { SemaphorePool } from 'data-semaphore';
import { Knex } from 'knex';

export interface MediaSyncOptions {
    repositories : string[];
    kinds : MediaKind[];
    cleanMissing : boolean;
    refetchExisting : boolean;
    refetchIncomplete : boolean;
    updateMoved : boolean;
    dryRun : boolean;
    cache : CacheOptions;
    autoFinishTask : boolean;
    repairMode : MediaSyncRepairMode;
    localArtworkPreservation : ArtworkPreservationMode;
    incomingArtworkAcceptance : ArtworkAcceptanceMode;
    refreshRecords: {kind: MediaKind, id: string}[];
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

    async runRecordForeigns ( table : AbstractMediaTable<any>, media : MediaRecord, snapshot : MediaSyncSnapshot ) {
        for ( let property of Object.keys( table.foreignMediaKeys ) ) {
            if ( media[ property ] ) {
                const kind = table.foreignMediaKeys[ property ];

                media[ property ] = await snapshot.association.get( kind ).get( media[ property ] ).promise;
            }
        }
    }

    /**
     * @param task
     * @param media
     * @param snapshot
     */
    async runRecord ( context: MediaSyncContext, media : MediaRecord ) {
        const { task, snapshot, repair, cache } = context;

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

        let match = await table.findOne( q => q.where( 'internalId', media.internalId ).where( 'repository', media.repository ) );

        if ( match ) {
            snapshot.scanBarrier.ready();

            future.resolve( match.id );

            await this.runRecordForeigns( table, media, snapshot );

            await this.updateRecord( context, match, media, true );
        } else {
            const existingMatch = snapshot.getAnyExternal( media.external );

            if ( existingMatch != null && snapshot.options.updateMoved ) {
                snapshot.duplicated.push( media );

                snapshot.scanBarrier.ready();
            } else {
                snapshot.scanBarrier.ready();

                await this.runRecordForeigns( table, media, snapshot );

                match = await this.createRecord( context, media );

                future.resolve( match.id );
            }
        }
    }

    async runDuplicate ( context: MediaSyncContext, media : MediaRecord ) {
        const { task, snapshot, repair } = context;

        const table = this.media.getTable( media.kind );

        await this.runRecordForeigns( table, media, snapshot );

        media = await this.createRecord( context, media );

        snapshot.association.get( media.kind ).get( media.internalId ).resolve( media.id );
    }

    async createRecord ( context: MediaSyncContext, media : MediaRecord ) : Promise<MediaRecord> {
        const { task, snapshot, repair } = context;

        // Create
        if ( !snapshot.options.dryRun ) {
            const table = this.media.getTable( media.kind );

            const now = new Date();

            media = await table.create( {
                ...table.baseline,
                ...media as any,
                createdAt: now,
                updatedAt: now
            } );

            await repair.onCreate( media );
        } else {
            media.id = media.internalId;
        }

        task.reportCreate( media, context.repository );

        await this.runCast( context, media );

        return media;
    }

    async updateRecord ( context: MediaSyncContext, oldRecord : MediaRecord, newRecord : MediaRecord, reportChanges : boolean = true ) {
        const { task, snapshot, repair } = context;

        const table = this.media.getTable( newRecord.kind );

        newRecord = { ...newRecord };

        for ( let property of Object.keys( table.foreignMediaKeys ) ) {
            delete newRecord[ property ];
        }

        for ( let key of Object.keys( table.baseline ) ) {
            delete newRecord[ key ];
        }

        newRecord = await this.applyArtworkPolicies( context, oldRecord, newRecord );

        const changed = table.isChanged( oldRecord, newRecord );

        if ( changed && !snapshot.options.dryRun ) {
            await table.updateIfChanged( oldRecord, newRecord, { updatedAt: new Date() } );

            newRecord.id = oldRecord.id;

            await repair.onUpdate( oldRecord );
        }

        if ( changed && reportChanges ) {
            const changes = table.getLocalChanges( oldRecord, newRecord );

            task.reportUpdate( oldRecord, newRecord, changes );
        }

        await this.runCast( context, newRecord );
    }

    async moveRecord ( context: MediaSyncContext, oldRecord : MediaRecord, newRecord : MediaRecord ) {
        await this.updateRecord( context, oldRecord, newRecord, false );

        context.task.reportMove( oldRecord, newRecord );
    }

    async deleteRecord ( context: MediaSyncContext, record : MediaRecord ) {
        const { task, snapshot, repair } = context;

        if ( !snapshot.options.dryRun ) {
            const table = this.media.getTable( record.kind );

            await repair.onRemove( record );

            await table.delete( record.id );
        }

        task.reportRemove( record );
    }

    async runCast<R extends MediaRecord> ( context: MediaSyncContext, media : R ) {
        const { task, cache } = context;

        const dryRun = context.snapshot.options.dryRun;

        let existingPeopleCount = 0;

        let createdPeopleCount = 0;

        const peopleTable = this.database.tables.people;

        const table = this.media.getTable( media.kind );

        if ( !media.scraper ) {
            task.reportError( media.kind, `Has no scraper defined. Could not get cast.`, media );

            return;
        }

        if ( !this.scrapers.hasKeyed( media.scraper ) ) {
            task.reportError( media.kind, `Could not find scraper "${ media.scraper }". Could not get cast.`, media );

            return;
        }

        // We get the scraper media record associated with our local `media` record (using the external object)
        // We do this so we can then get the record's internal scraper id to get the cast
        // NOTE: We cannot use the `media.internalId` value, because that is the repository's internal ID, not the scraper.
        const scraperMedia = await this.scrapers.getMediaExternal( media.scraper, media.kind, media.external, {}, cache );

        if ( !scraperMedia ) {
            task.reportError( media.kind, `No external media found for ${ JSON.stringify( media.external ) }. Could not get cast.`, media );

            return;
        }

        // A list of RoleRecord from the scraper
        const newRoles : RoleRecord[] = await this.scrapers.getMediaCast( media.scraper, media.kind, scraperMedia.id, {}, cache );

        // A map associating the internal id (meaning, the id from the scraper)
        // and the existing person record in the local database
        // The role that associates the person and the media is accessible
        // via the `.cast` property on each PersonRecord
        const existingRoles : Map<string, PersonRecord> = collect(
            await table.relations.cast.load( media ),
            filtering( role => role.cast.scraper == media.scraper,
                groupingBy( role => role.cast.internalId, first() ) )
        );

        // This will contain the internalIds of the new roles that don't
        // have anyone on the database associated with them for this media record
        const newPeopleRolesId = newRoles.map( role => role.internalId ).filter( id => id && !existingRoles.has( id ) );

        // And we will search OTHER media records for the same person and see what we find
        const newPeopleRoles : MediaCastRecord[] = collect( 
            await this.database.tables.mediaCast.find( q => q.whereIn( 'internalId', newPeopleRolesId ).where( 'scraper', media.scraper ) ), 
            // TODO SQL personId != null needed?
            filtering( p => p.personId != null && p.scraper == media.scraper, distinct( p => p.internalId ) )
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
                        }, null );
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
                        person = await peopleTable.create( person );
                    }

                    createdPeopleCount++;
                }

                const cast : Partial<MediaCastRecord> = {
                    internalId: role.internalId,
                    external: {},
                    mediaId: media.id,
                    mediaKind: media.kind,
                    order: role.order,
                    appearences: role.appearances,
                    role: role.role,
                    scraper: media.scraper,
                    personId: person.id,
                };

                if ( !dryRun ) {
                    if ( matchRole != null ) {
                        await this.database.tables.mediaCast.updateIfChanged( matchRole.cast, cast, {
                            updatedAt: new Date()
                        } );
                    } else {
                        await this.database.tables.mediaCast.create( {
                            ...cast as any,
                            updatedAt: new Date(),
                            createdAt: new Date(),
                        } );
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
        const toBeRemovedIds = Array.from( existingRoles.values() ).map( person => person.cast.id );

        // NOTE: There may also exist some roles associated with this media record, but from a different scraper
        // (might happen after an existing repository changes scrapers, for example). In such cases, these casts
        // will not be included in the existingRoles, but we also want them to be removed, so we add them here
        // toBeRemovedIds.
        toBeRemovedIds.push( ...collect(
            await table.relations.cast.load( media ),
            filtering( person => person.cast.scraper != media.scraper, mapping( person => person.cast.id ) )
        ) );

        const deletedCastCount = await this.database.tables.mediaCast.deleteKeys( toBeRemovedIds );

        return { createdPeopleCount, existingPeopleCount, deletedCastCount };
    }

    /**
     * Applies the settings given by the user regarding local artwork
     * preservation and incoming artwork acceptance for the new record.
     *
     * @param context The Media Sync Context object
     * @param oldRecord The local record that already exists in the Database
     * @param newRecord The incoming record recently scraped
     * @returns A shallow clone of newRecord with the artwork replaced appropriately
     */
    async applyArtworkPolicies ( context : MediaSyncContext, oldRecord : MediaRecord, newRecord : MediaRecord ) : Promise<MediaRecord> {
        const preservationMode = context.snapshot.options.localArtworkPreservation;
        const acceptanceMode = context.snapshot.options.incomingArtworkAcceptance;

        const artKey = 'art' as const;

        const localArt = oldRecord[ artKey ];
        const incomingArt = newRecord[ artKey ];

        // Create a shallow clone of the newRecord
        const finalRecord = {
            art: {},
            ...newRecord
        };

        if ( preservationMode == ArtworkPreservationMode.Keep ) {
            if ( artKey in oldRecord ) {
                finalRecord[ artKey ] = oldRecord[ artKey ];
            } else {
                delete finalRecord[ artKey ];
            }
        } else {
            // If the preservation mode is not Keep, then it is one of the Discard modes

            // Create a distinct set with all the artwork keys from both the old
            // record and the new one
            const keys = new Set( [
                ...Object.keys( localArt || {} ),
                ...Object.keys( incomingArt || {} )
            ] );

            for ( const subKey of keys ) {
                // Default is to preserve, here we check if it is discard
                let preserveLocal = true;
                // Always convert undefineds to nulls
                const oldValue = localArt[ subKey ] ?? null;

                // Artwork keys that are not strings or null, are always preserved
                if ( oldValue == null || typeof oldValue === 'string' ) {
                    if ( preservationMode === ArtworkPreservationMode.DiscardIfEmpty ) {
                        // Discard (not preserve) if empty (null)
                        if ( oldValue == null ) {
                            preserveLocal = false;
                        }
                    } else if ( preservationMode === ArtworkPreservationMode.DiscardIfInvalid ) {
                        // Discard (not preserve) if empty (null) or invalid
                        if ( oldValue == null || !await isArtworkValid( oldValue ) ) {
                            preserveLocal = false;
                        }
                    }
                }


                // Default is to reject, here we check if it is to accept
                let acceptIncoming = false;
                // Always convert undefineds to nulls
                const newValue = incomingArt[ subKey ] ?? null;

                // Only accept values that are null or string
                if ( newValue == null || typeof newValue === 'string' ) {
                    if ( acceptanceMode === ArtworkAcceptanceMode.Always ) {
                        acceptIncoming = true;
                    } else if ( acceptanceMode === ArtworkAcceptanceMode.WhenNotEmpty ) {
                        if ( newValue != null ) {
                            acceptIncoming = true;
                        }
                    } else if ( acceptanceMode === ArtworkAcceptanceMode.WhenNotInvalid ) {
                        if ( newValue != null && await isArtworkValid( newValue ) ) {
                            acceptIncoming = true;
                        }
                    }
                }

                // Apply the decision table
                //   -  preserve &&  accept = oldValue
                //   -  preserve && !accept = oldValue
                //   - !preserve && !accept = null
                //   - !preserve &&  accept = newValue
                if ( preserveLocal ) {
                    finalRecord[ artKey ][ subKey ] = oldValue;
                } else if ( acceptIncoming ) {
                    finalRecord[ artKey ][ subKey ] = newValue;
                } else {
                    finalRecord[ artKey ][ subKey ] = null;
                }
            }
        }

        return finalRecord;
    }

    async findRepositoryRecordsMap ( repository : IMediaRepository ) : Promise<RecordsMap<MediaRecord>> {
        const recordsSet = createRecordsMap<MediaRecord>();

        for ( let [ kind, set ] of recordsSet ) {
            const table = this.media.getTable( kind );

            if ( table ) {
                const allRecords = table.findStream( query => query.where( { repository: repository.name } ) );
                
                for await ( let record of allRecords ) {
                    set.set( record.internalId, record );
                }
            }
        }

        return recordsSet;
    }

    async findIncompleteRecords ( repository : IMediaRepository ) : Promise<MediaRecordFilter[]> {
        const episodes = await this.database.tables.episodes.findStream( query => query.where( { repository: repository.name } ) )
            .filter( ep => ep.art.thumbnail == null || ep.plot == null || !ep.external )
            .toArray();

        const seasons = await this.database.tables.seasons.findStream( query => query.where( { repository: repository.name } ) )
            .filter( se => se.art.poster == null )
            .toArray();

        return [ await MediaSetFilter.list( [...episodes, ...seasons], this.media ) ];
    }

    async run ( task : MediaSyncTask = null, options : Partial<MediaSyncOptions> = {} ) : Promise<void> {
        task = task || new MediaSyncTask();

        task.setStateStart();

        options = { ...options };

        if ( !( 'repositories' in options ) ) options.repositories = Array.from( this.repositories.keys() );

        if ( !( 'kinds' in options ) ) options.kinds = AllMediaKinds;

        task.addTotal( options.cleanMissing ? 2 : 1 );

        const repair = new MediaPostSyncRepair( this.database, options.repairMode ?? MediaSyncRepairMode.OnlyChanged );

        // Media Record Conditions that are shared by all the repositories
        let globalConditions: MediaRecordFilter[] = [];

        if ( options.refreshRecords != null ) {
            // Convert the array of objects {kind, id} into the array of tuples [kind, id]
            const refs = options.refreshRecords.map( ( { kind, id } ) => [ kind, id ] as const );

            // Convert the array of tuples into an array of MediaRecords, by fetching them from the database
            const records = await this.media.getAll( refs );

            // Finally create a MediaRecordFilter from the list of records
            globalConditions.push( await MediaSetFilter.list( records, this.media ) );
        }

        for ( let repositoryName of options.repositories ) {
            const repository = this.repositories.get( repositoryName );

            let updating : Promise<void>[] = [];

            if ( repository.indexable ) {
                const snapshot = await MediaSyncSnapshot.from( this.media, options, repository.name );

                const context: MediaSyncContext = {
                    repository, task, snapshot, repair, cache: options.cache || {}
                };

                // Allows setting up special conditions for refreshing particular media records
                const conditions : MediaRecordFilter[] = [];

                if ( options.refetchIncomplete ) {
                    conditions.push( ...await this.findIncompleteRecords( repository ) );
                }

                if ( globalConditions.length > 0 ) {
                    conditions.push( ...globalConditions );
                }

                snapshot.scanBarrier.freeze();

                task.reportsLogger = this.logger.service( repository.name )

                const recordsStream = repository.scan( options.kinds, snapshot, conditions, options.cache || {}, task );

                for await ( let media of AsyncStream.from( recordsStream ).observe( { onError: err => this.logger.error( err + '\n' + err.stack ) } ).dropErrors() ) {
                    task.addTotal( 1 );

                    media = { ...media };

                    media.internalId = media.id;
                    delete media.id;

                    media.repository = repositoryName;

                    updating.push(
                        task.do(
                            this.runRecord( context, media ),
                        1 )
                    );
                }

                snapshot.scanBarrier.unfreeze();

                await snapshot.scanBarrier.block();

                if ( options.cleanMissing || options.updateMoved ) {
                    const deleting : Promise<void>[] = [];
                    const moving : Promise<void>[] = [];

                    // Mark any media mean to be ignored as touched
                    if ( repository.ignoreUnreachableMedia ) {
                        for ( let [ record, touched ] of snapshot.recordsIter() ) {
                            if ( touched ) continue;

                            if ( !await repository.isMediaReachable( record ) ) {
                                // Mark this media as touched
                                snapshot.touched.get( record.kind ).add( record.id );
                            }
                        }

                        // If an episode or season were touched, make sure their parent entities
                        // (season and show, respectively) are also marked as touched so they are
                        // not removed
                        for ( let [ record, touched ] of snapshot.recordsIter( [ MediaKind.TvEpisode, MediaKind.TvSeason ] ) ) {
                            if ( !touched ) continue;

                            if ( isTvEpisodeRecord( record ) ) {
                                snapshot.touched.get( MediaKind.TvSeason ).add( record.tvSeasonId );
                            }

                            if ( isTvSeasonRecord( record ) ) {
                                snapshot.touched.get( MediaKind.TvShow ).add( record.tvShowId );
                            }
                        }
                    }

                    // We must iterate over the records loaded into memory before the sync started
                    // because we're not awaiting for all records to be stored inside, since
                    // we need to check if they are to be removed first (to allow updateMoved)
                    for ( let [ record, touched ] of snapshot.recordsIter() ) {
                        if ( touched ) continue;

                        task.addTotal( 1 );

                        const duplicate = snapshot.popDuplicated( record );

                        if ( options.updateMoved && duplicate != null ) {
                            snapshot.association.get( record.kind ).get( duplicate.internalId ).resolve( record.id );

                            moving.push( task.do( this.moveRecord( context, record, duplicate ), 1 ) );
                        } else if ( options.cleanMissing ) {
                            deleting.push( task.do( this.deleteRecord( context, record ), 1 ) );
                        }
                    }

                    for ( let record of snapshot.duplicated ) {
                        updating.push(
                            task.do(
                                this.runDuplicate( context, record ),
                            1 )
                        );
                    }

                    await task.do( Promise.all( updating ), 1 );

                    await task.do( Promise.all( deleting ), 1 );

                    await task.do( Promise.all( moving ), 1 );
                }
            }
        }

        if ( options.autoFinishTask ?? true ) {
            task.setStateFinish();
        }
    }
}

export interface MediaSyncContext {
    repository: IMediaRepository;
    task: MediaSyncTask;
    snapshot: MediaSyncSnapshot;
    cache: CacheOptions;
    repair: MediaPostSyncRepair;
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
                const allRecords = table.findStream( query => query.where( { repository: repository } ) );

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
        for ( let key of Object.keys( external || {} ) ) {
            if ( external[ key ] ) {
                this.addExternal( key, external[ key ], record );
            }
        }
    }

    public getAnyExternal ( external : any ) : MediaRecord {
        for ( let key of Object.keys( external || {} ) ) {
            const records = this.getExternal( key, external[ key ] );

            if ( records && records.length > 0 ) {
                return records[ 0 ];
            }
        }
    }

    public deleteExternalRecord ( record : MediaRecord ) {
        for ( let key of Object.keys( record.external || {} ) ) {
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
        const ext = record.external || {};

        const extKeys = Object.keys( ext ).filter( key => ext[ key ] != null );

        let index = this.duplicated.findIndex( dup => dup.kind == record.kind && extKeys.some( key => ext[ key ] == dup.external[ key ] ) );

        if ( index >= 0 ) {
            return this.duplicated.splice( index, 1 )[ 0 ];
        }

        return null;
    }

    public * recordsIter ( kinds : MediaKind[] = null ) : IterableIterator<[MediaRecord, boolean]> {
        if ( kinds === null ) {
            kinds = Array.from( this.records.keys() );
        }

        for ( let kind of kinds ) {
            if ( !this.records.has( kind ) ) continue;

            for ( let record of this.records.get( kind ).values() ) {
                yield [ record, this.touched.get( kind ).has( record.id ) ];
            }
        }
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

export class MediaSyncTask extends BackgroundTask {
    reports : MediaSyncReportConfigurable[] = [];

    statusMessage : string;

    reportsLogger : Logger;

    public recordToString ( record : MediaRecord ) : string {
        if ( record == null ) {
            return '<none>';
        }

        if ( isTvEpisodeRecord( record ) ) {
            return record.title + ' ' + ( record as PlayableMediaRecord ).sources[ 0 ].id;
        } else if ( isMovieRecord( record ) ) {
            return `${ record.title } (${ record.year }) ${ record.sources[ 0 ].id }`;
        } else {
            return record.title;
        }
    }

    reportError ( kind : MediaKind, label : string, media : MediaRecord = null, file : string = null ) {
        this.reports.push( { type: 'error', kind, label, media, file, new: true } );

        if ( this.reportsLogger != null ) {
            this.reportsLogger.error( `[${ kind } ${this.recordToString( media )}] ${ label }` );
        }
    }

    reportCreate ( record : MediaRecord, repository: IMediaRepository ) {
        const userConfig: MediaSyncConfiguration = {
            repository: repository.name,
            // TODO
            key: null,
        };

        this.reports.push( { type: 'create', record, userConfig } );

        if ( this.reportsLogger != null ) {
            this.reportsLogger.info( 'CREATE ' + this.recordToString( record ) );
        }
    }

    reportUpdate ( oldRecord : MediaRecord, newRecord : MediaRecord, changes : any ) {
        this.reports.push( { type: 'update', oldRecord, newRecord, changes } );

        if ( this.reportsLogger != null ) {
            // this.reportsLogger.info( 'UPDATE ' + oldRecord.id + ' ' + this.recordToString( newRecord ) + ' ' + JSON.stringify( changes ) );
        }
    }

    reportMove ( oldRecord : MediaRecord, newRecord : MediaRecord ) {
        this.reports.push( { type: 'move', oldRecord, newRecord } );

        if ( this.reportsLogger != null ) {
            this.reportsLogger.info( 'MOVE ' + oldRecord.id + ' ' + this.recordToString( oldRecord ) + ' ' + newRecord.id + ' ' + this.recordToString( newRecord ) );
        }
    }

    reportRemove ( record : MediaRecord ) {
        this.reports.push( { type: 'remove', record } );

        if ( this.reportsLogger != null ) {
            this.reportsLogger.info( 'DELETE ' + record.id + ' ' + this.recordToString( record ) );
        }
    }

    toJSON ( filter ?: { reportsIndex?: number } ) {
        let reports = this.reports;

        if ( filter?.reportsIndex != null ) {
            if ( +filter.reportsIndex < reports.length ) {
                reports = reports.slice( +filter.reportsIndex );
            } else {
                reports = [];
            }
        }

        return { ...super.toJSON( filter ), statusMessage: this.statusMessage, reports: reports };
    }
}

export enum ArtworkPreservationMode {
    // Always discard the artwork
    Discard = 0,
    // Discard the artwork only if it is empty
    DiscardIfEmpty = 1,
    // Update the existing artwork only if it is either missing or is invalid
    // (the file is corrupted, for example)
    DiscardIfInvalid = 2,
    // Do not touch the artwork fields
    Keep = 3,
}

export enum ArtworkAcceptanceMode {
    // Always accept the artwork
    Always = 0,
    // Only accept the artwork if it is not empty
    WhenNotEmpty = 1,
    // Only accept the artwork if it is not empty or invalid
    WhenNotInvalid = 2,
    // Always reject the artwork
    Never = 3,
}

export type MediaSyncConfiguration = {
    repository: string;
    key: unknown;
    data?: unknown;
}

export type MediaSyncReport =
      { type: 'error', kind : MediaKind, label : string, file ?: string, media ?: MediaRecord, new : boolean }
    | { type: 'create', record : MediaRecord }
    | { type: 'update', oldRecord : MediaRecord, newRecord : MediaRecord, changes : any }
    | { type: 'move', oldRecord : MediaRecord, newRecord : MediaRecord }
    | { type: 'remove', record : MediaRecord };

export type MediaSyncReportConfigurable = MediaSyncReport & {
    userConfig?: MediaSyncConfiguration
};

export enum MediaSyncRepairMode {
    // Does not run repair after syncing media
    Disabled = 0,
    // Run repair only on the rows affected by the changes executed during sync
    OnlyChanged = 1,
    // Run full database repair
    Full = 2,
}

export class MediaPostSyncRepair {
    public database : Database;

    public repairMode: MediaSyncRepairMode;

    /// The id of all the shows who were changed (directly, or indirectly, through
    /// their seasons and episodes) during the sync process
    public touchedShows: Set<string> = new Set();

    /// The ids of all the movies that were changed during the sync process
    public touchedMovies: Set<string> = new Set();

    /// The ids of all the custom media that were changed during the sync process
    public touchedCustom: Set<string> = new Set();

    /// If the collections should be repaired. Usually is only needed when a media record
    /// is removed
    public touchedCollections: boolean = false;

    /// A cached map between a season's ID and the show's ID, to avoid redundant calls
    /// to the database
    protected tvSeasonShowIds: Map<string, string> = new Map();

    protected tvSeasonShowLock: SemaphorePool<string> = new SemaphorePool( 1, true );

    public constructor ( database: Database, repairMode: MediaSyncRepairMode = MediaSyncRepairMode.OnlyChanged ) {
        this.database = database;
        this.repairMode = repairMode;
    }

    protected async getTvShowIdForTvSeason ( tvSeasonId: string ) {
        if ( this.tvSeasonShowIds.has( tvSeasonId ) ) {
            return this.tvSeasonShowIds.get( tvSeasonId );
        }

        const release = await this.tvSeasonShowLock.acquire( tvSeasonId );

        try {
            const season = await this.database.tables.seasons.get( tvSeasonId );

            this.tvSeasonShowIds.set( tvSeasonId, season.tvShowId );

            return season.tvShowId;
        } finally {
            release();
        }
    }

    public async onCreate ( record: MediaRecord ) {
        if ( isMovieRecord( record ) ) {
            this.touchedMovies.add( record.id );
        } else if ( isCustomRecord( record ) ) {
            this.touchedCustom.add( record.id );
        } else if ( isTvShowRecord( record ) ) {
            this.touchedShows.add( record.id );
        } else if ( isTvSeasonRecord( record ) ) {
            if ( !this.tvSeasonShowIds.has( record.id ) ) {
                this.tvSeasonShowIds.set( record.id, record.tvShowId );
            }

            this.touchedShows.add( record.tvShowId );
        } else if ( isTvEpisodeRecord( record ) ) {
            this.touchedShows.add( await this.getTvShowIdForTvSeason( record.tvSeasonId ) );
        }
    }

    public onUpdate ( record: MediaRecord ) {
        return this.onCreate( record );
    }

    public onRemove ( _record: MediaRecord ) {
        this.touchedCollections = true;
    }

    public async run () {
        if ( this.repairMode === MediaSyncRepairMode.Disabled ) return;

        if ( this.repairMode === MediaSyncRepairMode.Full ) {
            await this.database.repair();
        } else if ( this.repairMode === MediaSyncRepairMode.OnlyChanged ) {
            await this.database.tables.movies.repair( Array.from( this.touchedMovies ) );

            await this.database.tables.shows.repair( Array.from( this.touchedShows ) );

            await this.database.tables.custom.repair( Array.from( this.touchedCustom ) );

            if ( this.touchedCollections ) {
                this.database.tables.collections.repair();

                this.database.tables.collectionsMedia.repair();
            }

            await this.database.tables.people.repair();

            await this.database.tables.mediaCast.repair();
        }
    }
}

/**
 * TODO: Implement actual validation to verify if the artwork is valid: if it is
 * reachable and the data is not corrupt
 * @param artwork The address (local file or http) to validate
 * @returns
 */
export async function isArtworkValid ( artwork: string ) {
    return true;
}
