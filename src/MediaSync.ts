import { Database } from "./Database/Database";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { DiagnosticsService, Diagnostics } from "./Diagnostics";
import { MediaKind, AllMediaKinds, MediaRecord, TvShowMediaRecord, PlayableMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, MovieMediaRecord, createRecordsSet, RecordsSet, createRecordsMap } from "./MediaRecord";
import { BackgroundTask } from "./BackgroundTask";
import { MediaManager } from "./UnicastServer";
import { Future } from "@pedromsilva/data-future";
import { IMediaRepository } from "./MediaRepositories/MediaRepository";

export interface MediaSyncOptions {
    repositories : string[];
    kinds : MediaKind[];
    cleanMissing : boolean;
    refetchExisting : boolean;
    dryRun : boolean;
}

export class MediaSync {
    media : MediaManager;

    database : Database;

    repositories : RepositoriesManager;

    diagnostics : DiagnosticsService;

    constructor ( media : MediaManager, db : Database, repositories : RepositoriesManager, diagnostics : Diagnostics ) {
        this.media = media;
        this.database = db;
        this.repositories = repositories;
        this.diagnostics = diagnostics.service( 'media/sync' );
    }

    print ( record : MediaRecord ) : string {
        if ( record.kind === MediaKind.TvEpisode || record.kind === MediaKind.Movie ) {
            return record.title + ' ' + ( record as PlayableMediaRecord ).sources[ 0 ].id;
        } else {
            return record.title;
        }
    }

    async runRecord ( task : BackgroundTask, media : MediaRecord, association : Map<string, Map<string, Promise<string>>>, touched : Map<string, Set<string>>, dryRun : boolean = false ) {
        const table = this.media.getTable( media.kind );

        const future = new Future<string>();

        association.get( media.kind ).set( media.internalId, future.promise );

        let match = ( await table.findAll( [ media.internalId ], { index: 'internalId', query : query => query.filter( { repository: media.repository } ).limit( 1 ) } ) ) [ 0 ]

        for ( let property of Object.keys( table.foreignMediaKeys ) ) {
            if ( media[ property ] ) {
                const kind = table.foreignMediaKeys[ property ];

                media[ property ] = await association.get( kind ).get( media[ property ] );
            }
        }

        if ( match ) {
            future.resolve( match.id );
            // Update
            if ( !dryRun ) await table.updateIfChanged( match, media );
            
            this.diagnostics.info( 'UPDATE ' + match.id + ' ' + this.print( media ) );
        } else {
            // Create
            if ( !dryRun ) {
                match = await table.create( {
                    ...table.baseline,
                    ...media as any
                } );

                this.diagnostics.info( 'CREATE ' + this.print( media ) );
            } else {
                match = media;
                media.id = media.internalId;
            }

            future.resolve( match.id );
        }

        touched.get( media.kind ).add( match.id );
    }

    async deleteRecord ( task : BackgroundTask, record : MediaRecord, dryRun : boolean = false ) {
        if ( !dryRun ) {
            const table = this.media.getTable( record.kind );

            await table.delete( record.id );
        }

        this.diagnostics.info( 'DELETE ' + record.id + ' ' + this.print( record ) );
    }

    async findRepositoryRecordsSet ( repository : IMediaRepository ) : Promise<RecordsSet> {
        const recordsSet = createRecordsSet();

        for ( let [ kind, set ] of recordsSet ) {
            const table = this.media.getTable( kind );

            if ( table ) {
                const allRecords = table.findStream( query => query.filter( { repository: repository.name } ).pluck( 'internalId' ) );
                
                for await ( let record of allRecords ) {
                    set.add( record.internalId );
                }
            }
        }

        return recordsSet;
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
                const association = createRecordsMap<Promise<string>>();
                const touched = createRecordsSet();

                // When the `refetchExisting` option is set to false, media records that are already on the database are not scraped
                // But for that it is necessary to know which records exist in the database
                // So instead of querying the database each time for each record found, we'll just store all of them in this Records Set
                // When the `refetchExisting``is true, we just provide an empty Record Set, so that all records are refetched
                const recordsToIgnore = options.refetchExisting ? createRecordsSet() : await this.findRepositoryRecordsSet( repository );

                for await ( let media of repository.scan( options.kinds, recordsToIgnore ) ) {
                    task.addTotal( 1 );
                    
                    media = { ...media };
                    
                    media.internalId = media.id;
                    delete media.id;
                    
                    media.repository = repositoryName;
                    
                    // TODO make sure when one promise is rejected, it doesn't take down the whole synchronization
                    updating.push(
                        task.do(
                            this.runRecord( task, media, association, touched, options.dryRun ), 
                        1 )
                    );
                }

                await task.do( Promise.all( updating ), 1 );
                
                if ( options.cleanMissing ) {
                    const deleting : Promise<void>[] = [];
    
                    for ( let kind of AllMediaKinds ) {
                        const table = this.media.getTable( kind );
            
                        for ( let record of await table.find( query => query.filter( { repository: repositoryName } ) ) ) {
                            if ( !touched.get( record.kind ).has( record.id ) ) {
                                task.addTotal( 1 );

                                deleting.push( task.do( this.deleteRecord( task, record, options.dryRun ), 1 ) );
                            }
                        }
                    }
    
                    await task.do( Promise.all( deleting ), 1 );
                }

                task.setStateFinish();
            }
        }
    }
}
