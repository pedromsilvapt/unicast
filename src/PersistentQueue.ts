import { JobRecord, JobsQueueTable } from "./Database/Database";
import { UnicastServer } from "./UnicastServer";
import { AsyncInterval, setAsyncInterval, clearAsyncInterval } from "./ES2017/AsyncInterval";
import { Semaphore } from "data-semaphore";
import { Knex } from 'knex';
import { addMilliseconds, isBefore } from 'date-fns';
import * as sortBy from 'sort-by';
import { Logger } from 'clui-logger';

export enum JobResult {
    DidNotRun = 'DNR',
    Error = 'ERR',
    Success = 'SUC'
}

export class PersistentQueue<P> {
    server : UnicastServer;

    maxTries : number = 1;

    action : string;

    logger : Logger;

    protected _scheduler ?: IJobScheduler<P>;

    get scheduler () : IJobScheduler<P> {
        return this._scheduler;
    }
    
    set scheduler ( scheduler : IJobScheduler<P> ) {
        if ( this._scheduler ) {
            this._scheduler.stop();
        }

        this._scheduler = scheduler;

        if ( this._scheduler ) {
            this.server.database.installed.then( () => this._scheduler.start( this ) );
        }
    }

    protected get table () : JobsQueueTable {
        return this.server.database.tables.jobsQueue;
    }

    constructor ( server : UnicastServer, action : string, scheduler ?: IJobScheduler<P> ) {
        this.server = server;
        this.action = action;
        this.scheduler = scheduler;

        this.logger = this.server.logger.service( this.action ? `jobs/${ this.action }` : 'jobs' );
    }

    async canRun ( jobs  : JobRecord<P>[] ) : Promise<boolean> {
        return false;
    }

    async getById ( id : string ) : Promise<JobRecord<P>> {
        const job = await this.table.get( id );

        if ( this.action && job.action != this.action ) {
            return null;
        }

        return job;
    }

    async find ( query ?: ( query : Knex.QueryBuilder ) => Knex.QueryBuilder ) : Promise<JobRecord<P>[]> {
        return this.table.find( q => {
            if ( this.action ) {
                q = q.where( { action: this.action } );
            }

            if ( query ) {
                return query( q );
            }

            return q;
        } );
    }

    async findReplaced ( job : JobRecord<P> ) : Promise<JobRecord<P>[]> {
        return [];
    }

    protected createJobRecord ( payload : P, priority : number = 0 ) : JobRecord<P> {
        const job = {
            action: this.action,
            payload: payload,
            priority : priority,

            pastAttempts : 0,
            maxAttempts : this.maxTries,
            nextAttempt : null,

            createdAt : new Date(),
            updatedAt : new Date(),
            attemptedAt : null,
        };

        job.nextAttempt = this.scheduler ? this.scheduler.getNextAttempt( job ) : null;

        return job;
    }

    protected async insert ( job : JobRecord<P> ) : Promise<JobRecord<P>> {
        this.logger.debug( `Creating job with priority ${ job.priority }.`, job.payload as any );
        
        const replaced = await this.findReplaced( job );
        
        if ( replaced.length ) {
            const replacedIds = replaced.map( job => job.id );
            
            this.logger.debug( `Deleting outdated ${ replaced.length } jobs.`, replacedIds );

            await this.table.deleteMany( q => q.whereIn( 'id', replacedIds ) );
        }

        const record = await this.table.create( job );

        return record;
    }

    async create ( payload : P, priority : number = 0 ) : Promise<JobRecord<P>> {
        const record = await this.insert( this.createJobRecord( payload, priority ) );

        if ( this.scheduler ) {
            this.scheduler.awake( this );
        }

        return record;
    }

    protected async tryRun ( job : JobRecord<P> ) : Promise<JobResult> {
        return JobResult.DidNotRun;
    }

    async run ( job : JobRecord<P>, transient : boolean = false ) : Promise<JobResult> {
        const release = this.scheduler ? await this.scheduler.acquire() : null;

        let result : JobResult;

        try {
            result = await this.tryRun( job );
        } catch ( error ) {
            result = JobResult.Error;
        } finally {
            if ( release ) {
                release();
            }
        }

        this.logger.debug( `Ran job ${ job.id } with result ${ result }.`, { payload: job.payload, result } );        

        if ( result === JobResult.Success ) {
            if ( job.id ) {
                await this.table.delete( job.id );
            }
        } else if ( result === JobResult.Error ) {
            job.pastAttempts += 1;
            job.attemptedAt = new Date();
            job.nextAttempt = this.scheduler ? this.scheduler.getNextAttempt( job ) : null;

            if ( job.pastAttempts < job.maxAttempts ) {
                if ( job.id ) {
                    await this.table.update( job.id, job );
                } else if ( !transient ) {
                    await this.insert( job );
                }
            } else if ( job.id ) {
                await this.table.delete( job.id );
            }
        } else if ( result === JobResult.DidNotRun ) {
            if ( !job.id && !transient ) {
                await this.insert( job );
            }
        }

        if ( this.scheduler ) {
            this.scheduler.awake( this );
        }

        return result;
    }

    createAndRun ( payload : P, transient : boolean = false ) : Promise<JobResult> {
        return this.run( this.createJobRecord( payload ), transient );
    }
}

export interface IJobScheduler<P> {
    getNextAttempt ( job : JobRecord<P> ) : Date;

    getNext ( queue : PersistentQueue<P> ) : Promise<JobRecord<P>>;

    findNext ( queue : PersistentQueue<P>, limit ?: number ) : Promise<JobRecord<P>[]>;

    start ( queue : PersistentQueue<P> ) : void;

    stop () : void;

    sleep ( queue : PersistentQueue<P> ) : void;

    awake ( queue : PersistentQueue<P> ) : void;

    acquire () : Promise<() => void>;
}

export enum JobOrder {
    FIFO = 0,
    LIFO = 1
};

export interface IntervalJobSchedulerOptions {
    interval : number;
    retryInterval : number;
    order : JobOrder;
    maxConcurrent : number;
}

export class IntervalJobScheduler<P> implements IJobScheduler<P> {
    interval : number;

    retryInterval : number;

    order : JobOrder;

    get maxConcurrent () {
        return this._maxConcurrent;
    }

    set maxConcurrent ( value : number ) {
        if ( this.semaphore ) {
            this.semaphore.count += value - this._maxConcurrent;
        }        

        this._maxConcurrent = value;
    }

    protected intervalToken : AsyncInterval;

    protected _maxConcurrent : number = 1;

    protected semaphore : Semaphore;

    constructor ( options : Partial<IntervalJobSchedulerOptions> ) {
        options = {
            interval : 1000 * 10,
            retryInterval : 1000 * 60,
            order : JobOrder.FIFO,
            maxConcurrent : 1,
            ...options
        };

        this.interval = options.interval;
        this.retryInterval = options.retryInterval;
        this.order = options.order;
        this.maxConcurrent = options.maxConcurrent;

        this.semaphore = new Semaphore( this.maxConcurrent );
    }

    getNextAttempt ( job : JobRecord<P> ) : Date {
        return addMilliseconds( new Date(), this.retryInterval );
    }

    async getNext ( queue : PersistentQueue<P> ) : Promise<JobRecord<P>> {
        return ( await this.findNext( queue, 1 ) )[ 0 ];
    }

    async findNext ( queue : PersistentQueue<P>, limit : number = Infinity ) : Promise<JobRecord<P>[]> {
        // query => {
            // filter( doc => doc( 'nextAttempt' ).lt( new Date() ) )
            // query = query.orderBy( r.desc( 'priority' ), r.asc( 'attemptedAt' ) );

        //     if ( limit < Infinity ) {
        //         query = query.limit( limit );
        //     }
            
        //     return query;
        // } 
        
        let tasks = await queue.find();

        const now = new Date();

        tasks = tasks.filter( job => !job.nextAttempt || isBefore( job.nextAttempt, now ) );

        tasks.sort( sortBy( '-priority', 'attemptedAt' ) );

        if ( limit != Infinity ) {
            tasks = tasks.slice( 0, limit );
        }

        return tasks;
    }

    protected async flush ( queue : PersistentQueue<P> ) {
        const jobs = await this.findNext( queue, this.semaphore.count );
        
        queue.logger.debug( `Running ${ jobs.length } jobs.` );

        const results = await Promise.all( jobs.map( job => queue.run( job ) ) );

        if ( jobs.length == 0 || !await queue.canRun( await this.findNext( queue ) ) ) {
            this.sleep( queue );
        }
    }

    start ( queue : PersistentQueue<P> ) : void {
        if ( this.intervalToken ) {
            this.stop();
        }

        this.intervalToken = setAsyncInterval( this.flush.bind( this, queue ), this.interval );
    }

    stop () : void {
        clearAsyncInterval( this.intervalToken );
    }

    sleep ( queue : PersistentQueue<P> ) {
        if ( this.intervalToken.isAwake ) {
            queue.logger.debug( `Going to sleep.` );
            
            this.intervalToken.sleep();
        }
    }

    awake ( queue : PersistentQueue<P> ) {
        if ( !this.intervalToken.isAwake ) {
            queue.logger.debug( `Waking up.` );
            
            this.intervalToken.awake();
        }
    }

    acquire () : Promise<() => void> {
        return this.semaphore.acquire();
    }
}
