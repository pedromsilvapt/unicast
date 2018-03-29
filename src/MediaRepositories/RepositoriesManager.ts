import { IMediaRepository } from "./BaseRepository/IMediaRepository";
import { MediaKind } from "../MediaRecord";
import { UnicastServer } from "../UnicastServer";
import { MediaRecord } from "../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { PersistentQueue, JobResult, IntervalJobScheduler, JobOrder } from "../PersistentQueue";
import { JobRecord } from "../Database";
import * as itt from 'itt';

export class RepositoriesManager {
    protected groupedByKind : Map<MediaKind, IMediaRepository[]> = new Map();

    protected groupedByName : Map<string, IMediaRepository[]> = new Map();

    protected jobQueue : MediaRepositoryPersistentQueue;

    constructor ( server : UnicastServer ) {
        this.jobQueue = new MediaRepositoryPersistentQueue( server, 'repositories', new IntervalJobScheduler( {
            interval: 5000, 
            retryInterval: 1000 * 60, 
            order: JobOrder.LIFO,
            maxConcurrent: 5
        } ) );
    }

    add ( repository : IMediaRepository ) {
        if ( !this.groupedByKind.has( repository.kind ) ) {
            this.groupedByKind.set( repository.kind, [ repository ] );
        } else {
            this.groupedByKind.get( repository.kind ).push( repository );
        }

        if ( !this.groupedByName.has( repository.name ) ) {
            this.groupedByName.set( repository.name, [ repository ] );
        } else {
            this.groupedByName.get( repository.name ).push( repository );
        }
    }

    addMany ( repositories : IMediaRepository[] ) {
        for ( let repository of repositories ) {
            this.add( repository );
        }
    }

    delete ( repository : IMediaRepository ) {
        if ( this.groupedByKind.has( repository.kind ) ) {
            this.groupedByKind.set( repository.kind, this.groupedByKind.get( repository.kind ).filter( rep => rep === repository ) );
        }

        if ( this.groupedByName.has( repository.name ) ) {
            this.groupedByName.set( repository.name, this.groupedByName.get( repository.name ).filter( rep => rep === repository ) );
        }
    }

    deleteMany ( repositories : IMediaRepository[] ) {
        for ( let repository of repositories ) {
            this.delete( repository );
        }
    }

    get ( name : string, kind : MediaKind ) : IMediaRepository {
        if ( !this.groupedByName.has( name ) ) {
            return null;
        }

        return this.groupedByName.get( name ).find( rep => rep.kind === kind );
    }

    getByKind ( kind : MediaKind ) : IMediaRepository[] {
        if ( !this.groupedByKind.has( kind ) ) {
            return [];
        }

        return this.groupedByKind.get( kind );
    }

    getByName ( name : string ) : IMediaRepository[] {
        if ( !this.groupedByName.has( name ) ) {
            return [];
        }

        return this.groupedByName.get( name );
    }

    async watch ( record : MediaRecord, watched ?: boolean ) {
        await this.jobQueue.createAndRun( { id: record.internalId, repository: record.repository, kind: record.kind, watched } );
    }
}


export interface MediaRepositoryItemUpdate {
    id ?: string;
    repository : string;
    kind : MediaKind;
    watched : boolean;
}

export class MediaRepositoryPersistentQueue extends PersistentQueue<MediaRepositoryItemUpdate> {
    maxTries : number = 4;

    async findReplaced ( job : JobRecord<MediaRepositoryItemUpdate> ) : Promise<JobRecord<MediaRepositoryItemUpdate>[]> {
        return this.find( query => query.filter( {
            payload: {
                id: job.payload.id,
                kind: job.payload.kind,
                repository: job.payload.repository
            }
        } ) );
    }

    async canRun ( jobs : JobRecord<MediaRepositoryItemUpdate>[] ) : Promise<boolean> {
        const repositories = itt( jobs ).groupBy( job => job.payload.repository );

        for ( let [ name, jobs ] of repositories ) {
            const kinds = itt( jobs ).map( job => job.payload.kind ).unique().toArray();

            for ( let kind of kinds ) {
                const repository = this.server.repositories.get( name, kind );

                if ( repository && await repository.available() ) {
                    return true;
                }
            }
        }

        return false;
    }

    protected async tryRun ( job : JobRecord<MediaRepositoryItemUpdate> ) : Promise<JobResult> {
        const repository = this.server.repositories.get( job.payload.repository, job.payload.kind );

        if ( repository && repository.watch ) {
            if ( !await repository.available() ) {
                return JobResult.DidNotRun;
            }
    
            await repository.watch( job.payload.id, job.payload.watched );
        }

        return JobResult.Success;
    }
}