import { TranscodingBackgroundTask } from "../TranscodingDriver";
import * as progressStream from 'ffmpeg-progress-stream';
import { ChildProcess, spawn } from "child_process";
import * as path from 'path';
import { SegmentsMap, Segment } from "./SegmentsMap";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import * as uid from 'uid';
import { CancelToken } from "../../ES2017/CancelToken";
import { BackgroundTaskState, BackgroundTask, BackgroundTaskMetric } from "../../BackgroundTask";
import { Deferred } from "../../ES2017/Deferred";
import { SegmentsScheduler, SegmentsSchedulerJob } from "./SegmentsScheduler";
import { MediaRecord } from "../../MediaRecord";

export class FFmpegHlsTranscodingTask extends TranscodingBackgroundTask {
    record : MediaRecord;

    input : VideoMediaStream;

    driver : FFmpegHlsDriver;
    
    destination : string;

    encoders : Map<string, FFmpegHlsTranscodingProcessTask> = new Map();

    segments : SegmentsMap<{ id: string }>;

    scheduler : SegmentsScheduler<{ id: string }>;
    
    protected averageMetric : AverageBackgroundMetric<number>;

    constructor ( record : MediaRecord, input : VideoMediaStream, driver : FFmpegHlsDriver, destination : string ) {
        super();

        this.record = record;

        this.input = input;

        this.driver = driver;
        
        this.destination = destination;

        this.segments = new SegmentsMap( this.input.duration, 3.003200 );

        this.scheduler = new SegmentsScheduler( this.segments );

        this.metrics.push( this.averageMetric = new AverageBackgroundMetric( 'Speed', this ) );

        this.scheduler.on( 'start-job', ( job : SegmentsSchedulerJob ) => job.id = this.createProcessFor( job.segment.start ) );

        this.scheduler.on( 'cancel-job', ( job : SegmentsSchedulerJob ) => setTimeout( () => this.destroyProcess( job.id ), 2000 ) );
    }

    getSegmentTime ( index : number ) : number {
        return Math.min( index * 3.003200, this.input.duration );
    }

    destroyProcess ( id : string ) {
        if ( !this.encoders.has( id ) ) {
            throw new Error( `Could not find an encoding process with the id "${ id }"` );
        }

        this.encoders.get( id ).setStateCancel();

        this.encoders.delete( id );
    }

    createProcessFor ( index : number, cancel ?: CancelToken ) : string {
        if ( this.state === BackgroundTaskState.Cancelled || this.state === BackgroundTaskState.Finished ) {
            throw new Error( 'Cannot start process for a terminated task.' );
        }

        console.log( 'starting process for', index );

        const segment = this.segments.findNextEmpty( index );

        const id = uid();

        if ( segment ) {
            const encoder = new FFmpegHlsTranscodingProcessTask( this, this.driver, segment );
            
            this.encoders.set( id, encoder );

            encoder.setStateStart();

            this.averageMetric.addSubMetric( encoder.metrics[ 0 ] );

            encoder.whenCompleted().then( () => {
                this.destroyProcess( id );
            } );

            if ( cancel ) {
                cancel.whenCancelled().then( () => {
                    encoder.setStateCancel();

                    this.encoders.delete( id );
                } );
            }
        }

        return id;
    }

    requestSegment ( index : number ) {
        if ( this.state !== BackgroundTaskState.Running ) {
            return false;
        }

        this.scheduler.request( index );
    }

    protected async onStart () {
        this.scheduler.request( 0 );
    }

    protected onCancel () {
        for ( let [ id, encoder ] of Array.from( this.encoders ) ) {
            encoder.setStateCancel();
            
            this.encoders.delete( id );
        }
    }
}

export class FFmpegHlsTranscodingProcessTask extends BackgroundTask {
    mainTask : FFmpegHlsTranscodingTask;

    driver : FFmpegHlsDriver;

    segment : Segment;
    
    doneSegment : Segment;

    process : ChildProcess;

    protected completed : Deferred<void> = new Deferred();

    cancelable : boolean = true;

    speedMetrics : SpeedMetrics;

    whenCompleted () : Promise<void> {
        return this.completed.promise;
    }

    static cloneDriver ( mainTask : FFmpegHlsTranscodingTask, driver : FFmpegHlsDriver, segment : Segment ) : FFmpegHlsDriver {
        driver = new FFmpegHlsDriver( driver.server ).import( driver );
        
        if ( segment.start > 0 ) {
            driver.setStartTime( mainTask.getSegmentTime( segment.start ) );

            driver.setSegmentStartNumber( segment.start );
        }

        if ( ( segment.end && !mainTask.input.duration ) || segment.end != mainTask.segments.totalCount ) {
            driver.setOutputDuration( mainTask.getSegmentTime( segment.end + 2 ) - mainTask.getSegmentTime( segment.start ) );
        }

        return driver;
    }

    constructor ( mainTask : FFmpegHlsTranscodingTask, driver : FFmpegHlsDriver, segment : Segment ) {
        super();

        this.segment = segment;
        this.doneSegment = { start: null, end: null };
        this.mainTask = mainTask;
        this.driver = FFmpegHlsTranscodingProcessTask.cloneDriver( mainTask, driver, segment );
        this.total = segment.end - segment.start;
    }

    withinRange ( index : number ) : boolean {
        return this.segment.start <= index && this.segment.end >= index && ( this.doneSegment.end || this.segment.start ) + 10 >= index;
    }

    async onStart () {
        try {
            this.speedMetrics = new SpeedMetrics( this );

            this.metrics.push( this.speedMetrics );

            const id = uid();
            
            await this.driver.server.storage.ensureDir( path.join( this.mainTask.destination, id ) );

            const args = [ ...this.driver.getCompiledArguments( this.mainTask.record, this.mainTask.input ), path.join( this.mainTask.destination, id, 'index.m3u8' ) ];

            if ( this.state != BackgroundTaskState.Running ) {
                return;
            }
            
            let child = spawn( this.driver.getCommandPath(), args );

            this.process = child;

            child.on( 'error', error => console.error( error ) );
            
            let lastSegment : number = this.segment.start;

            child.stderr.on( 'data', d => {
                const line = d.toString().trim();
                
                if ( line.startsWith( '[hls @' ) && line.endsWith( 'for writing' ) ) {
                    const matches = line.match( /index([0-9]*)\.ts/i );
                    
                    if ( matches && matches.length ) {
                        while ( lastSegment <= +matches[ 1 ] ) {
                            this.addDone( 1 );

                            this.mainTask.scheduler.insert( lastSegment, { id } );
                            
                            lastSegment++;
                        }

                        this.doneSegment.start = this.segment.start;
                        this.doneSegment.end = lastSegment - 1;
                    }
                }
             } ).on( 'end', () => {
                 if ( this.doneSegment.end === this.segment.end ) {
                     this.completed.resolve();
    
                     this.setStateFinish();
                 }
             } );

            child.stderr.pipe( progressStream( Infinity ) ).on( 'data', status => {
                this.speedMetrics.register( +status.speed.slice( 0, status.speed.length - 1 ) );

                this.addDone( status.frame - this.done );
            } );
        } catch ( error ) {
            console.error( error );
        }
    }

    onPause () {
        this.process.kill( 'SIGSTOP' );
    }

    onResume () {
        this.process.kill( 'SIGCONT' );
    }

    onCancel () {
        this.process.kill( 'SIGINT' );
    }
}

export class AverageBackgroundMetric<T> extends BackgroundTaskMetric<number> {
    metrics : Map<BackgroundTaskMetric<T>, number> = new Map;

    name: string;

    constructor ( name : string, task : BackgroundTask ) {
        super( task );

        this.name = name;
    }

    protected triggerRegister () {
        if ( this.metrics.size ) {
            const sum = Array.from( this.metrics.values() )
                .reduce( ( a, b ) => a + b, 0 )

            const avg = sum / this.metrics.size;

            this.register( avg );
        }
    }

    addSubMetric ( metric : BackgroundTaskMetric<T> ) {
        this.metrics.set( metric, null );

        metric.on( 'point', ( point : T ) => {
            if ( this.metrics.has( metric ) ) {
                this.metrics.set( metric, metric.valueToNumber( point ) );

                this.triggerRegister();
            }
        } );
    }

    removeSubMetric  ( metric : BackgroundTaskMetric<T> ) {
        this.metrics.delete( metric );

        this.metrics.delete( metric );
    }

    valueToNumber ( value : number ) : number {
        return value;
    }

    valueToString( value : number ) : string {
        return value.toFixed( 2 ) + 'x';
    }
}

export class SpeedMetrics extends BackgroundTaskMetric<number> {
    name : string = 'Speed';

    valueToNumber( value : number ) : number {
        return value;
    }

    valueToString ( value : number ) : string {
        return value + 'x';
    }
}