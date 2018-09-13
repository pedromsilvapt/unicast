import { Database } from "./Database/Database";
import { RepositoriesManager } from "./MediaRepositories/RepositoriesManager";
import { DiagnosticsService, Diagnostics } from "./Diagnostics";
import { MediaKind, AllMediaKinds, MediaRecord, TvShowMediaRecord, PlayableMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, MovieMediaRecord } from "./MediaRecord";
import { BackgroundTask } from "./BackgroundTask";
import * as isVideo from 'is-video';
import * as chalk from 'chalk';
import { MediaManager } from "./UnicastServer";
import { Future } from "@pedromsilva/data-future";

export interface MediaSyncOptions {
    repositories : string[];
    kinds : MediaKind[];
    cleanMissing : boolean;
    dryRun : boolean;
}

function createRecordsMap <T> () : Map<MediaKind, Map<string, T>> {
    const map : Map<MediaKind, Map<string, T>> = new Map();

    for ( let kind of AllMediaKinds ) map.set( kind, new Map() );

    return map;
}

function createRecordsSet () : Map<MediaKind, Set<string>> {
    const set : Map<MediaKind, Set<string>> = new Map();

    for ( let kind of AllMediaKinds ) set.set( kind, new Set() );

    return set;
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
            // console.log( 'update', match.id, this.print( media ) );
        } else {
            // Create
            if ( !dryRun ) {
                match = await table.create( {
                    ...table.baseline,
                    ...media as any
                } );
                console.log( 'create', this.print( media ) );
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

        console.log( 'delete', this.print( record ) );
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

                for await ( let media of repository.scan( options.kinds ) ) {
                    task.addTotal( 1 );
                    
                    media = { ...media };
                    
                    media.internalId = media.id;
                    delete media.id;
                    
                    media.repository = repositoryName;
                    
                    // TODO make sure when one promise is rejected, it doesn't take down the whole synchronization
                    updating.push( task.do( this.runRecord( task, media, association, touched, options.dryRun ), 1 ) );
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

export class MediaMigration {
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

    getMappingKey ( media : MediaRecord, tvShowMapper ?: Map<string, MediaRecord> ) : string {
        if ( media.kind == MediaKind.Movie || media.kind == MediaKind.TvEpisode ) {
            return ( media as PlayableMediaRecord ).sources.map( file => file.id ).filter( id => isVideo( id ) )[ 0 ];
        } else if ( media.kind == MediaKind.TvShow ) {
            return media.external.tvdb || media.external.imdb;
        } else if ( media.kind == MediaKind.TvSeason ) {
            const tvShowId = ( media as TvSeasonMediaRecord ).tvShowId;

            return ( tvShowMapper && tvShowMapper.has( tvShowId ) ? tvShowMapper.get( tvShowId ).id : tvShowId ) + '|' + ( media as TvSeasonMediaRecord ).number;
        }
    }

    async getMapping () : Promise<Map<string, Map<string, MediaRecord>>> {
        const mapping : Map<string, Map<string, MediaRecord>> = new Map()

        for ( let kind of AllMediaKinds ) mapping.set( kind, new Map() );

        for ( let table of [ this.database.tables.movies, this.database.tables.episodes, this.database.tables.shows, this.database.tables.seasons ] ) {
            const items = await table.find();

            console.log( table.constructor.name, items.length );
            
            for ( let media of items ) {
                const key = this.getMappingKey( media );

                if ( key == 'F:\\Series\\Falling Skies\\Season 1\\Falling.Skies.S01E01-02.720p.HDTV.x264-IMMERSE.mkv' ) {
                    console.log( media.id, media.repository );
                }
    
                if ( key ) {
                    mapping.get( media.kind ).set( key, media );
                } else {
                    console.log( `Could not find file in `, media.sources, media.external );
                }
            }
        }

        return mapping;
    }

    printMediaRecord ( record : MediaRecord ) : string {
        if ( record.kind === MediaKind.TvSeason ) {
            return record.title + ' ' + ( record as TvSeasonMediaRecord ).number;
        } else if ( record.kind === MediaKind.TvEpisode || record.kind === MediaKind.Movie ) {
            return chalk.green( ( record as PlayableMediaRecord ).sources.map( s => s.id ).find( s => isVideo( s ) ) ) + ' ' + record.title;
        } else {
            return record.title;
        }
    }

    async match ( options : Partial<MediaSyncOptions> ) {
        const mapping = await this.getMapping();

        const migration : {
            deleted : MediaRecord[],
            created : MediaRecord[],
            updated : [MediaRecord, MediaRecord][],
            association : Map<string, Map<string, MediaRecord>>
        } = {
            deleted: [],
            created: [],
            updated: [],
            association: new Map()
        };

        for ( let kind of AllMediaKinds ) migration.association.set( kind, new Map() );

        // for ( let [ kind, records ] of mapping ) {
        //     if ( records.size > 0 ) console.log( kind, records.size, Array.from( records )[ 0 ][ 0 ] );
        //     else console.log( kind, records.size );
        // }

        // let tvShowsMapper : Map<string, string> = new Map();

        for ( let repositoryName of options.repositories ) {
            const repository = this.repositories.get( repositoryName );

            for await ( let media of repository.scan( options.kinds ) ) {
                media.repository = repositoryName;

                const key = this.getMappingKey( media, migration.association.get( MediaKind.TvShow ) );

                const original = mapping.get( media.kind ).get( key );

                if ( original ) {
                    mapping.get( media.kind ).delete( key );

                    migration.association.get( media.kind ).set( media.id, original );
                    migration.updated.push( [ original, media ] );
                } else {
                    migration.created.push( media );
                }
            }
            
            // await drain( flatMapConcurrent( repository.scan( options.kinds ), media => {
            //    return [];
            // }, 4 ) );
        }

        for ( let records of mapping.values() ) migration.deleted = migration.deleted.concat( Array.from( records.values() ) );

        return migration;
    }

    getAssoc ( migration : any, kind : MediaKind, original : string ) : string {
        const related = migration.association.get( kind ).get( original );

        if ( related ) {
            return related.id;
        }

        return null;
    }

    async run ( task : BackgroundTask = null, options : Partial<MediaSyncOptions> = {} ) : Promise<void> {
        task = task || new BackgroundTask();

        options = { ...options };

        if ( !( 'repositories' in options ) ) options.repositories = Array.from( this.repositories.keys() );

        if ( !( 'kinds' in options ) ) options.kinds = AllMediaKinds;

        const migration = await this.match( options );

        for ( let record of migration.deleted ) {
            // await this.media.getTable( record.kind ).delete( record.id );
            console.log( "deleting", record.kind, record.id, ( record as any ).addedAt );
        }

        const updates : Promise<any>[] = [];

        let updatedCount = 0;

        for ( let [ old, recent ] of migration.updated ) {
            if ( recent.kind === MediaKind.TvSeason ) {
                const season = recent as TvSeasonMediaRecord;

                season.internalId = season.id;
                season.tvShowId = ( old as any ).tvShowId;
                delete season.id;
                delete season.kind;
                delete season.watchedEpisodesCount;
            } else if ( recent.kind === MediaKind.TvEpisode ) {
                const episode = recent as TvEpisodeMediaRecord;

                episode.internalId = episode.id;
                episode.tvSeasonId = ( old as any ).tvSeasonId;
                delete episode.id;
                delete episode.kind;
                delete episode.watched;
                delete episode.lastPlayed;
                delete episode.playCount;
                delete episode.addedAt;
            } else if ( recent.kind == MediaKind.TvShow ) {
                const show = recent as TvShowMediaRecord;

                show.internalId = show.id;
                delete show.id;
                delete show.kind;
                delete show.watchedEpisodesCount;
                delete show.watched;
                delete show.addedAt;
            } else if ( recent.kind == MediaKind.Movie ) {
                const movie = recent as MovieMediaRecord;

                movie.internalId = movie.id;
                delete movie.id;
                delete movie.kind;
                delete movie.watched;
                delete movie.playCount;
                delete movie.lastPlayed;
            }

            updatedCount++;
            // updates.push( this.media.getTable( old.kind ).updateIfChanged( old, recent ).then( () => {
            //     // console.log( "updating", old.kind, old.id, old.addedAt, --updatedCount );
            //  } ).catch( err => console.log( "error updating", err.message, old.kind, old.id, ( old as any ).addedAt, --updatedCount ) ) );

            // if ( old.kind == MediaKind.Movie ) {
            //     const file = recent.sources.map( s => s.id ).find( f => isVideo( f ) );
                
            //     if ( file && file.includes( '_NOT_MEANT_TO_BE_SEEN' ) ) {
            //         updates.push( this.database.tables.collectionsMedia.create( {
            //             collectionId : '3f7a8399-59fa-412a-a503-26b2db834334',
            //             mediaKind : old.kind,
            //             mediaId : old.id,
            //             createdAt : new Date()
            //         } ) );
            //     }
            // }
        }

        await Promise.all( updates );
        console.log( updates.length );

        for ( let kind of [ MediaKind.Movie, MediaKind.TvShow, MediaKind.TvSeason, MediaKind.TvEpisode ] ) {
            for ( let record of migration.created.filter( rec => rec.kind == kind ) ) {
                if ( record.kind === MediaKind.TvSeason ) {
                    const season = record = {
                        watchedEpisodesCount: 0,
                        ...record
                    } as TvSeasonMediaRecord;
    
                    season.tvShowId = this.getAssoc( migration, MediaKind.TvShow, season.tvShowId );
    
                    if ( !season.tvShowId ) {
                        console.log( 'No show association for ', season.number, season.art.poster );
                        continue;
                    }
                } else if ( record.kind === MediaKind.TvEpisode ) {
                    const episode = record = {
                        watched: false,
                        lastPlayed: null,
                        playCount: 0,
                        ...record
                    } as TvEpisodeMediaRecord;

                    episode.tvSeasonId = this.getAssoc( migration, MediaKind.TvSeason, episode.tvSeasonId );

                    if ( !episode.tvSeasonId ) {
                        console.log( 'No season association for ', episode.number, episode.art.thumbnail );
                        continue;
                    }
                } else if ( record.kind === MediaKind.TvShow ) {
                    record = {
                        watched: false,
                        watchedEpisodesCount: false,
                        ...record as any
                     } as TvShowMediaRecord;
                } else if ( record.kind === MediaKind.Movie ) {
                    record = {
                        watched: false,
                        playCount: 0,
                        lastPlayed: null,
                        ...record
                    } as MovieMediaRecord;
                }

                
                // if ( migration.association.get( record.kind ).has( record.internalId ) ) {
                //     console.log( record );
                // }
                record.internalId = record.id;
                // TO ADD UNCOMMENT THIS //
                // delete record.id;
                // const inserted = await this.media.getTable( record.kind ).create( record );
                // record.id = inserted.id;
                // if ( !migration.association.get( kind ).has( record.id ) ) {
                //     migration.association.get( kind ).set( record.internalId, record );
                // }
                // console.log( "inserting", record.kind, record.id, ( record as any ).addedAt );
                // TO ADD UNCOMMENT THIS //
            }
        }


        // for ( let records of migration.created ) console.log( "NEW", kind, records.size );
        // for ( let [ kind, records ] of migration.deleted ) console.log( "OLD", kind, records.size );
    }
}