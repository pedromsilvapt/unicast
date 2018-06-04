import * as uid from 'uid';
import { CancelToken } from 'data-cancel-token'
import { EventEmitter } from 'events';

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

export class BackgroundTask extends EventEmitter {
    static fromPromise<T = any> ( fn : ( task : BackgroundTask ) => Promise<T> ) : [ BackgroundTask, Promise<T> ] {
        const task = new BackgroundTask().setStateStart();

        const promise = fn( task ).then( t => {
            task.setStateFinish();

            return t;
        }, error => {
            task.addError( error );

            task.setStateFinish();            

            return Promise.reject( error );
        } );
        
        return [ task, promise ];
    }

    id : string;

    cancelable : boolean = false;

    pausable : boolean = false;

    state : BackgroundTaskState = BackgroundTaskState.Unstarted;

    done : number = 0;

    total : number = 0;
    
    errors : any[] = [];

    metrics : BackgroundTaskMetric<any>[] = [];

    children : BackgroundTask[];

    addTaskChild ( child : BackgroundTask ) {
        this.children.push( child );

        this.emit( 'add-child', child );

        child.on( 'add-done', done => {
            this.addDone( done );
        } );
    }

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

    protected stopwatch : Stopwatch = new Stopwatch;

    get elapsedTime () : number {
        return this.stopwatch.readMilliseconds();
    }

    get remainingTime () : number {
        if ( this.state === BackgroundTaskState.Running || this.state === BackgroundTaskState.Paused ) {
            return getTimeStatistics( this.elapsedTime, this.done, this.total );
        }

        return 0;
    }

    protected onStart () {}

    setStateStart () : this {
        if ( this.state === BackgroundTaskState.Unstarted ) {
            this.stopwatch.resume();

            this.state = BackgroundTaskState.Running;

            this.triggerIntervals();

            this.onStart();
        }

        return this;
    }

    protected onCancel () {}

    setStateCancel () : this {
        if ( this.cancelable && this.state !== BackgroundTaskState.Cancelled && this.state !== BackgroundTaskState.Finished ) {
            this.stopwatch.pause();

            this.state = BackgroundTaskState.Cancelled;

            this.onCancel();
        }

        return this;
    }

    protected onPause () {}

    setStatePause () : this {
        if ( this.pausable && this.state === BackgroundTaskState.Running ) {
            this.stopwatch.pause();

            this.state = BackgroundTaskState.Paused;

            this.onPause();
        }

        return this;
    }

    protected onResume () {}

    setStateResume () : this {
        if ( this.pausable && this.state === BackgroundTaskState.Paused ) {
            this.stopwatch.resume();

            this.state = BackgroundTaskState.Running;

            this.onResume();
            
            this.triggerIntervals();
        }

        return this;
    }

    protected onFinish () {}

    setStateFinish () : this {
        if ( this.state === BackgroundTaskState.Running ) {
            this.stopwatch.pause();

            this.state = BackgroundTaskState.Finished;

            this.onFinish();    
        }

        return this;
    }

    protected onError( error : any ) {}

    addError ( error : any ) : this {
        this.errors.push( error );

        this.onError( error );

        this.emit( 'error', error );

        return this;
    }

    protected onProgress () {}

    addTotal ( amount : number = 1 ) {
        if ( amount != 0 ) {
            this.total += amount;
    
            this.onProgress();
    
            this.emit( 'progress' );
        }

        return this;
    }

    addDone ( amount : number = 1 ) : this {
        if ( amount != 0 ) {
            this.done += amount;
    
            this.onProgress();
    
            this.emit( 'progress' );
    
            this.emit( 'add-done', amount );
        }

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

            const isCanceled : boolean = cancel && cancel.cancellationRequested;

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
            metrics: this.metrics,
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

    has ( id : string ) : boolean {
        return this.tasks.has( id );
    }

    get ( id : string ) : BackgroundTask {
        if ( !this.tasks.has( id ) ) {
            return null;
        }

        return this.tasks.get( id );
    }
}

export abstract class BackgroundTaskMetric<V, T extends BackgroundTask = BackgroundTask> extends EventEmitter {
    abstract name : string;

    protected points : [ number, V ][] = [];

    protected stopwatch : Stopwatch = new Stopwatch;

    minimum : number = null;

    maximum : number = null;

    debounceTime : number = 0;

    task : T;

    memory : number = 10000;
    
    constructor ( task : T ) {
        super();

        this.task = task;
    }

    register ( value : V ) {
        const time = this.getTime();

        this.points.push( [ time, value ] );

        this.emit( 'point', value, time );

        this.freeMemory( time );
    }

    getTime () : number {
        return this.stopwatch.readMilliseconds();
    }

    pause () {
        this.stopwatch.pause();
    }

    resume () {
        this.stopwatch.resume();
    }

    freeMemory ( time ?: number ) {
        time = time || this.getTime();

        const threshold = time - this.memory;
        
        let i : number = 0;

        while ( i < this.points.length && this.points[ i ][ 0 ] < threshold ) i++;

        if ( i > 10 ) {
            this.points.splice( 0, i );
        }
    }

    abstract valueToNumber ( value : V ) : number;

    abstract valueToString ( value : V ) : string;

    toJSON () {
        return {
            name: this.name,
            minimum: this.minimum,
            maximum: this.maximum,
            debounceTime: this.debounceTime,
            now: this.getTime(),
            memory: this.memory,
            points: this.points.map<[number, number, string, V]>( ( [ t, v ] ) => [ t, this.valueToNumber( v ), this.valueToString( v ), v ] )
        };
    }
}

export class PercentageBackgroundTaskMetric extends BackgroundTaskMetric<number> {
    name : string = 'percentage';

    constructor ( task : BackgroundTask ) {
        super( task );

        this.task.every( 2000, () => {
            this.register( this.task.percentage );
        } );
    }

    valueToNumber ( value : number ) : number {
        return value;
    }

    valueToString ( value : number ) : string {
        return value.toFixed( 2 );
    }
}

export class Stopwatch {
    static sumTimes ( [ sa, ma ] : [ number, number ], [ sb, mb ] : [ number, number ] ) : [ number, number ] {
        const second = 1000 * 1000 * 1000;

        const m = ma + mb;

        return [ sa + sb + Math.floor( m / second ), ( m % second ) ];
    }

    protected startTime : [ number, number ] = null;

    protected bankedTime : [ number, number ] = [ 0, 0 ];

    state  : StopwatchState = StopwatchState.Paused;

    get paused () : boolean {
        return this.state === StopwatchState.Paused;
    }

    get running () : boolean {
        return this.state === StopwatchState.Running;
    }

    pause () : this {
        if ( this.state === StopwatchState.Running ) {
            this.state = StopwatchState.Paused;

            this.bankedTime = Stopwatch.sumTimes( this.bankedTime, process.hrtime( this.startTime ) );

            this.startTime = null;
        }

        return this;
    }

    resume () : this {
        if ( this.state === StopwatchState.Paused ) {
            this.state = StopwatchState.Running;
            
            this.startTime = process.hrtime();
        }

        return this;
    }

    read () : [ number, number ] {
        if ( this.paused ) {
            return this.bankedTime;
        }

        const time = process.hrtime( this.startTime );

        return Stopwatch.sumTimes( this.bankedTime, time );
    }

    readMilliseconds () : number {
        const [ seconds, nano ] = this.read();

        return seconds * 1000 + ( nano / 1000000 );
    }
}

export enum StopwatchState{
    Paused = 0,
    Running = 1
}