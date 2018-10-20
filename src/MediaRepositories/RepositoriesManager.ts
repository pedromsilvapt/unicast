import { MediaKind } from "../MediaRecord";
import { UnicastServer } from "../UnicastServer";
import { MediaRecord } from "../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { PersistentQueue, JobResult, IntervalJobScheduler, JobOrder } from "../PersistentQueue";
import { JobRecord } from "../Database/Database";
import * as itt from 'itt';
import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IMediaRepository } from "./MediaRepository";
import { RepositoryFactory } from "./RepositoryFactory";

export class RepositoriesManager extends EntityManager<IMediaRepository, string> {
    protected jobQueue : MediaRepositoryPersistentQueue;

    readonly factories : RepositoryFactoriesManager;

    constructor ( server : UnicastServer ) {
        super( server );

        this.factories = new RepositoryFactoriesManager( this, server );

        this.jobQueue = new MediaRepositoryPersistentQueue( server, 'repositories', new IntervalJobScheduler( {
            interval: 5000, 
            retryInterval: 1000 * 60, 
            order: JobOrder.LIFO,
            maxConcurrent: 5
        } ) );
    }

    protected getEntityKey ( entity : IMediaRepository ) : string {
        return entity.name;
    }

    async watch ( record : MediaRecord, watched ?: boolean ) {
        await this.jobQueue.createAndRun( { id: record.internalId, repository: record.repository, kind: record.kind, watched } );
    }
}

export class RepositoryFactoriesManager extends EntityFactoryManager<IMediaRepository, RepositoriesManager, RepositoryFactory<IMediaRepository>, string, string> {
    constructor ( repositories : RepositoriesManager, server : UnicastServer ) {
        super( repositories, server );
    }

    protected getEntityKey ( entity : RepositoryFactory<IMediaRepository> ) : string {
        return entity.type;
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

        for ( let name of repositories.keys() ) {
            const repository = this.server.repositories.get( name );

            if ( repository && !repository.watch ) {
                return true;
            }

            if ( repository && await repository.available() ) {
                return true;
            }
        }

        return false;
    }

    protected async tryRun ( job : JobRecord<MediaRepositoryItemUpdate> ) : Promise<JobResult> {
        const repository = this.server.repositories.get( job.payload.repository );

        if ( repository && repository.watch ) {
            if ( !await repository.available() ) {
                return JobResult.DidNotRun;
            }
    
            await repository.watch( job.payload.kind, job.payload.id, job.payload.watched );
        }

        return JobResult.Success;
    }
}