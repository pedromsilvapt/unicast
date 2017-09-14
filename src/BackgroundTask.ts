import * as uid from 'uid';
import { CancelToken } from './ES2017/CancelToken';

export function getMillisecondsProcessTime ( previous ?: [ number, number ] ) : number {
    const [ seconds, nano ] = process.hrtime( previous );

    return ( seconds * 1000 ) + ( nano / 1000000 );
}

export function getTimeStatistics ( elapsed : number, done : number, total : number ) : number {
    if ( done === 0 || total === 0 || total === Infinity || elapsed === 0 ) {
        return Infinity;
    }

    if ( done >= total ) {
        return 0;
    }

    return elapsed * total / done;
}

export class BackgroundTask {
    static fromPromise ( fn : ( task : BackgroundTask ) => Promise<void> ) : BackgroundTask {
        const task = new BackgroundTask().start();

        fn( task ).catch( error => task.addError( error ) ).then( () => task.finish() );
        
        return task;
    }

    id : string;

    cancelable : boolean = false;

    pausable : boolean = false;

    state : BackgroundTaskState = BackgroundTaskState.Running;

    done : number = 0;

    total : number = 0;
    
    errors : any[];

    get percentage () : number {
        if ( this.done === 0 || this.total === 0 ) {
            return 0;
        }

        return Math.max( Math.min( this.done * 100 / this.total, 100 ), 0 );
    }
    
    protected intervalsRecords : { 
        interval: number,
        fn: ( task : BackgroundTask ) => void,
        cancel ?: CancelToken
    }[] = [];

    protected startTime : [ number, number ];

    protected elapsedTimeShelved : number = 0;

    get elapsedTime () : number {
        if ( this.state === BackgroundTaskState.Running ) {
            return this.elapsedTimeShelved + getMillisecondsProcessTime( this.startTime );
        }

        return this.elapsedTimeShelved;
    }

    get remainingTime () : number {
        if ( this.state === BackgroundTaskState.Running || this.state === BackgroundTaskState.Paused ) {
            return getTimeStatistics( this.elapsedTime, this.done, this.total );
        }

        return 0;
    }

    start () : this {
        if ( this.state === BackgroundTaskState.Unstarted ) {
            this.startTime = process.hrtime();

            this.state = BackgroundTaskState.Running;

            this.triggerIntervals();
        }

        return this;
    }

    cancel () : this {
        if ( this.cancelable && this.state !== BackgroundTaskState.Cancelled ) {
            this.elapsedTimeShelved = this.elapsedTime;

            this.state = BackgroundTaskState.Cancelled;
        }

        return this;
    }

    pause () : this {
        if ( this.pausable && this.state === BackgroundTaskState.Running ) {
            this.elapsedTimeShelved = this.elapsedTime;

            this.state = BackgroundTaskState.Paused;
        }

        return this;
    }

    resume () : this {
        if ( this.pausable && this.state === BackgroundTaskState.Paused ) {
            this.startTime = process.hrtime();

            this.state = BackgroundTaskState.Running;

            this.triggerIntervals();
        }

        return this;
    }

    finish () : this {
        if ( this.state === BackgroundTaskState.Running ) {
            this.elapsedTimeShelved = this.elapsedTime;

            this.state = BackgroundTaskState.Finished;
        }

        return this;
    }

    addError ( error : any ) : this {
        this.errors.push( error );

        return this;
    }

    addTotal ( amount : number = 1 ) {
        this.total += amount;

        return this;
    }

    addDone ( amount : number = 1 ) : this {
        this.done += amount;

        return this;
    }

    protected triggerIntervals () {
        for ( let { interval, fn, cancel } of this.intervalsRecords ) {
            this.every( interval, fn, cancel );
        }

        this.intervalsRecords = [];
    }

    every ( interval : number, fn : ( task : BackgroundTask ) => void, cancel ?: CancelToken ) : this {
        const token = setInterval( () => {
            const isIddle : boolean = this.state === BackgroundTaskState.Cancelled || this.state === BackgroundTaskState.Finished;

            const isPaused : boolean = this.state === BackgroundTaskState.Paused;

            const isUnstarted : boolean = this.state === BackgroundTaskState.Unstarted;

            const isCanceled : boolean = cancel && cancel.isCancelled();

            if ( token && isIddle || isPaused || isCanceled ) {
                clearInterval( token );
            }

            if ( isPaused || isUnstarted ) {
                this.intervalsRecords.push( { interval, fn, cancel } );
            }

            if ( !isCanceled && !isUnstarted ) {
                fn( this );
            }
        }, interval );
        
        return this;
    }

    async do<T> ( promise : Promise<T>, amount : number = 0 ) : Promise<T> {
        try {
            return await promise;
        } catch ( error ) {
            this.addError( error );
        } finally {
            this.addDone( amount );
        }

        return null;
    }

    toJSON () {
        return {
            id: this.id,
            state: this.state,
            done: this.done,
            total: this.total,
            elapsedTime: this.elapsedTime,
            remainingTime: this.remainingTime,
            errors: this.errors,
            cancelable: this.cancelable,
            pausable: this.pausable
        };
    }
}

export enum BackgroundTaskState {
    Unstarted = 'unstarted',
    Running = 'running',
    Paused = 'paused',
    Cancelled = 'cancelled',
    Finished = 'finished'
}

export class BackgroundTasksManager {
    tasks : Map<string, BackgroundTask> = new Map();

    register ( task : BackgroundTask ) : this {
        if ( !task.id ) {
            const id = uid();
    
            task.id = id;
        }

        this.tasks.set( task.id, task );
        
        return this;
    }

    get ( id : string ) : BackgroundTask {
        if ( !this.tasks.has( id ) ) {
            return null;
        }

        return this.tasks.get( id );
    }
}