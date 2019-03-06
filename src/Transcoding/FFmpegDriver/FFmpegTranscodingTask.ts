import { TranscodingBackgroundTask } from "../TranscodingDriver";
import * as path from 'path';
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegDriver } from "./FFmpegDriver";
import { CancelToken } from 'data-cancel-token';
import { BackgroundTaskState, BackgroundTask, BackgroundTaskMetric } from "../../BackgroundTask";
import { Future } from '@pedromsilva/data-future';
import { MediaRecord } from "../../MediaRecord";
import { Segment } from '../FFmpegHlsDriver/SegmentsMap';
import { FFmpegProcess } from './FFmpegProcess';
import { DurationUnit } from '../../ES2017/Units';

export interface TranscodingTaskProgressReport {
    duration : number;
    current : number;
    speed : number;
    stable : boolean;
}

export class FFmpegTranscodingTask extends TranscodingBackgroundTask {
    static launch ( record : MediaRecord, input : VideoMediaStream, driver : FFmpegDriver, destination : string ) {
        const task = new FFmpegTranscodingTask( record, input, driver, destination );

        task.setStateStart();
        
        driver.server.tasks.register( task );

        return task;
    }

    record : MediaRecord;

    input : VideoMediaStream;

    driver : FFmpegDriver;
    
    destination : string;

    encoder : FFmpegTranscodingProcessTask = null;

    protected averageMetric : AverageBackgroundMetric<number>;

    constructor ( record : MediaRecord, input : VideoMediaStream, driver : FFmpegDriver, destination : string ) {
        super();

        this.record = record;

        this.input = input;

        this.driver = driver;
        
        this.destination = destination;

        this.metrics.push( this.averageMetric = new AverageBackgroundMetric( 'Speed', this ) );
    }

    getSegmentTime ( segment : number ) : number {
        return segment;
    }

    getTimeSegment ( time : number ) : number {
        return time;
    }

    createProcess ( cancel ?: CancelToken ) {
        if ( this.state === BackgroundTaskState.Cancelled || this.state === BackgroundTaskState.Finished ) {
            throw new Error( 'Cannot start process for a terminated task.' );
        }

        const encoder = new FFmpegTranscodingProcessTask( this, this.driver );
        
        this.encoder = encoder;

        encoder.setStateStart();

        this.averageMetric.addSubMetric( encoder.metrics[ 0 ] );

        encoder.wait().then( () => this.destroyProcess() );

        if ( cancel ) {
            cancel.cancellationPromise.then( () => {
                encoder.setStateCancel();

                this.encoder = null;
            } );
        }
    }

    destroyProcess () {
        if ( this.encoder != null ) {
            this.encoder.setStateCancel();
    
            this.encoder = null;
        }
    }

    isStable () {
        return !this.encoder || this.encoder.isStable();
    }

    getProgressReport ( time : number ) : TranscodingTaskProgressReport {
        let encoder = this.encoder;

        if ( encoder ) {
            if ( typeof encoder.doneSegment.end != 'number' ) {
                return { current: this.getSegmentTime( encoder.segment.start ), duration: this.getSegmentTime( encoder.segment.end ), speed: 0, stable: false };
            }

            const speed = encoder.getCurrentSpeed();

            const stable = encoder.isStable();

            return { current: this.getSegmentTime( encoder.doneSegment.end ), duration: this.getSegmentTime( encoder.segment.end ), speed, stable };
        }

        return {
            current: 0,
            duration: 0,
            speed: 0,
            stable: true
        };
        // const isAvailable = this.segments.has( segmentIndex );

        // const segment = this.segments.findNextEmpty( segmentIndex );

        // return { current: segment ? segment.start - 1 : 0, duration: this.getSegmentTime( this.segments.totalSize ), speed: 0, stable: isAvailable };
    }

    protected async onStart () {
        this.createProcess();
    }

    protected onCancel () {
        if ( this.encoder != null ) {
            this.encoder.setStateCancel();
                
            this.encoder = null;
        }
    }
}

// @UTIL
export function windowed <T> ( array : T[], size : number ) : T[][] {
    let results : T[][] = [];

    for ( let i = 0; i <= array.length - size; i++ ) {
        results.push( array.slice( i, i + size ) );
    }

    return results;
}

export class FFmpegTranscodingProcessTask extends BackgroundTask {
    mainTask : FFmpegTranscodingTask;

    driver : FFmpegDriver;

    process : FFmpegProcess;

    protected completed : Future<void> = new Future();

    cancelable : boolean = true;

    speedMetrics : SpeedMetrics;

    doneSegment : Segment;

    segment : Segment;

    static cloneDriver ( mainTask : FFmpegTranscodingTask, driver : FFmpegDriver, segment : Segment ) : FFmpegDriver {
        driver = new FFmpegDriver( driver.server ).import( driver );
        
        if ( segment ) {
            if ( segment.start > 0 ) {
                driver.setStartTime( mainTask.getSegmentTime( segment.start ) );
            }
    
            if ( ( segment.end && !mainTask.input.duration ) || mainTask.getSegmentTime( segment.end ) != mainTask.input.duration ) {
                driver.setOutputDuration( mainTask.getSegmentTime( segment.end + 2 ) - mainTask.getSegmentTime( segment.start ) );
            }
        } else {
            driver.setStartTime( null ).setOutputDuration( null );
        }

        return driver;
    }

    constructor ( mainTask : FFmpegTranscodingTask, driver : FFmpegDriver, segment ?: Segment ) {
        super();

        this.mainTask = mainTask;
        this.driver = FFmpegTranscodingProcessTask.cloneDriver( mainTask, driver, segment );
        this.segment = segment || { start: 0, end: this.mainTask.input.duration };
        this.doneSegment = { start: this.segment.start, end: this.segment.start };
    }

    getCurrentSpeed () : number {
        if ( !this.speedMetrics || this.speedMetrics.isEmpty() ) {
            return 0;
        }

        const [ _, speed ] = this.speedMetrics.getNewestPoint();

        return speed;
    }

    isStable () : boolean {
        const windowSize = 50;

        if ( !this.speedMetrics ) {
            return false;
        }

        if ( this.speedMetrics.points.length < 10 ) {
            return false;
        }

        const lastValues = this.speedMetrics.getNewerPointValues( windowSize );
        
        const diffs = windowed( lastValues, 2 ).map( ( [ a, b ] ) => Math.abs( a - b ) ).reduce( ( a, b ) => a + b, 0 );

        return diffs <= 0.004 * windowSize;
    }

    withinRange ( index : number ) : boolean {
        return this.segment.start <= index && this.segment.end >= index && ( this.doneSegment.end || this.segment.start ) + 10 >= index;
    }

    async createProcess ( speedMetrics : SpeedMetrics ) {
        const args = [ ...await this.driver.getCompiledArguments( this.mainTask.record, this.mainTask.input ), '-loglevel', 'error', '-stats', path.join( this.mainTask.destination, 'video.mkv' ) ];

        this.process = new FFmpegProcess( this.driver.getCommandPath(), args );

        this.process.onProgress.subscribe( progress => {
            this.doneSegment.start = this.segment.start;
                    
            this.doneSegment.end = progress.time.as( DurationUnit.SECONDS );
            
            this.addDone( this.doneSegment.end - this.done );
            
            this.emit( 'encoding-progress', progress );

            speedMetrics.register( +progress.speed );
        } );

        this.process.wait().then( () => {
            this.completed.resolve();
                
            this.setStateFinish();
        }, error => {
            // this.driver.server.onError.notify( error );

            this.completed.reject( error );
                
            this.setStateCancel();
        } );

        this.process.run( this.driver.getOutputDuration( this.mainTask.input ) );
    }

    onStart () {
        if ( this.state != BackgroundTaskState.Running ) {
            return;
        }

        this.speedMetrics = new SpeedMetrics( this );

        this.metrics.push( this.speedMetrics );

        this.createProcess( this.speedMetrics ).catch( err => this.addError( err ) );
    }

    onPause () {
        this.process.pause();
    }

    onResume () {
        this.process.resume();
    }

    onCancel () {
        this.process.kill();
    }
    
    wait () : Promise<void> {
        return this.completed.promise;
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