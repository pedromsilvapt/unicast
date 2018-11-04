import { TranscodingBackgroundTask } from "../TranscodingDriver";
import * as progressStream from 'ffmpeg-progress-stream';
import { ChildProcess, spawn } from "child_process";
import * as path from 'path';
import { SegmentsMap, Segment } from "./SegmentsMap";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegHlsDriver } from "./FFmpegHlsDriver";
import * as uid from 'uid';
import { CancelToken } from 'data-cancel-token';
import { BackgroundTaskState, BackgroundTask, BackgroundTaskMetric } from "../../BackgroundTask";
import { Future } from '@pedromsilva/data-future';
import { SegmentsScheduler, SegmentsSchedulerJob } from "./SegmentsScheduler";
import { MediaRecord } from "../../MediaRecord";

export interface TranscodingTaskProgressReport {
    duration : number;
    current : number;
    speed : number;
    stable : boolean;
}

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

        this.segments = new SegmentsMap( this.input.duration, this.getSegmentTime( 1 ) );

        this.scheduler = new SegmentsScheduler( this.segments );

        this.metrics.push( this.averageMetric = new AverageBackgroundMetric( 'Speed', this ) );

        this.scheduler.on( 'start-job', ( job : SegmentsSchedulerJob ) => job.id = this.createProcessFor( job.segment.start ) );

        this.scheduler.on( 'cancel-job', ( job : SegmentsSchedulerJob ) => setTimeout( () => this.destroyProcess( job.id ), 2000 ) );
    }

    getSegmentTime ( index : number ) : number {
        const framerate = this.input.metadata.tracks.find( track => track.type == 'video' ).framerate;

        const dur = 1000 * this.driver.getSegmentDuration();        

        return Math.min( index * Math.ceil( dur / framerate ) * framerate / 1000, this.input.duration );
    }

    getTimeSegment ( time : number ) : number {
        const framerate = this.input.metadata.tracks.find( track => track.type == 'video' ).framerate;

        const dur = 1000 * this.driver.getSegmentDuration();

        return Math.floor( time / ( Math.ceil( dur / framerate ) * framerate / 1000 ) );
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
                cancel.cancellationPromise.then( () => {
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

    getEncoderForTime ( time : number ) : FFmpegHlsTranscodingProcessTask {
        return this.getEncoderFor( this.getTimeSegment( time ) );
    }

    getEncoderFor ( index : number ) : FFmpegHlsTranscodingProcessTask {
        for ( let encoder of this.encoders.values() ) {
            if ( encoder.withinRange( index ) ) {
                return encoder;
            }
        }

        return null;
    }

    getNextEncoderForTime ( time : number ) : FFmpegHlsTranscodingProcessTask {
        return this.getNextEncoderFor( this.getTimeSegment( time ) );
    }
    
    getNextEncoderFor ( index : number ) : FFmpegHlsTranscodingProcessTask {
        let nextEncoder : FFmpegHlsTranscodingProcessTask = null;

        for ( let encoder of this.encoders.values() ) {
            if ( encoder.segment.start <= index || encoder.segment.end < index ) {
                continue;
            }

            if ( nextEncoder == null || encoder.segment.start < nextEncoder.segment.start ) {
                nextEncoder = encoder;
            }
        }
        
        return nextEncoder;
    }

    getCurrentOrNextEncoderFor ( index : number ) : FFmpegHlsTranscodingProcessTask {
        return this.getEncoderFor( index ) || this.getNextEncoderFor( index );
    }

    getCurrentOrNextEncoderForTime ( time : number ) : FFmpegHlsTranscodingProcessTask {
        return this.getCurrentOrNextEncoderFor( this.getTimeSegment( time ) );
    }

    isStable () {
        return Array.from( this.encoders.values() ).every( encoder => encoder.isStable() );
    }

    getProgressReport ( time : number ) : TranscodingTaskProgressReport {
        const segmentIndex = this.getTimeSegment( time );

        let encoder = this.getCurrentOrNextEncoderFor( segmentIndex );

        if ( encoder ) {
            if ( typeof encoder.doneSegment.end != 'number' ) {
                return { current: this.getSegmentTime( encoder.segment.start ), duration: this.getSegmentTime( encoder.segment.end ), speed: 0, stable: false };
            }

            const speed = encoder.getCurrentSpeed();

            const stable = encoder.isStable();

            return { current: this.getSegmentTime( encoder.doneSegment.end ), duration: this.getSegmentTime( encoder.segment.end ), speed, stable };
        }

        const isAvailable = this.segments.has( segmentIndex );

        const segment = this.segments.findNextEmpty( segmentIndex );

        return { current: segment ? segment.start - 1 : 0, duration: this.getSegmentTime( this.segments.totalSize ), speed: 0, stable: isAvailable };
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

// @UTIL
export function windowed <T> ( array : T[], size : number ) : T[][] {
    let results : T[][] = [];

    for ( let i = 0; i <= array.length - size; i++ ) {
        results.push( array.slice( i, i + size ) );
    }

    return results;
}

export class FFmpegHlsTranscodingProcessTask extends BackgroundTask {
    mainTask : FFmpegHlsTranscodingTask;

    driver : FFmpegHlsDriver;

    segment : Segment;
    
    doneSegment : Segment;

    process : ChildProcess;

    protected completed : Future<void> = new Future();

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

    getCurrentSpeed () : number {
        if ( this.speedMetrics.isEmpty() ) {
            return 0;
        }

        const [ _, speed ] = this.speedMetrics.getNewestPoint();

        return speed;
    }

    isStable () : boolean {
        const windowSize = 50;

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

    async onStart () {
        try {
            this.speedMetrics = new SpeedMetrics( this );

            this.metrics.push( this.speedMetrics );

            const id = uid();
            
            await this.driver.server.storage.ensureDir( path.join( this.mainTask.destination, id ) );

            const args = [ ...this.driver.getCompiledArguments( this.mainTask.record, this.mainTask.input ), path.join( this.mainTask.destination, id, 'index.m3u8' ) ];

            console.log( args.join( ' ' ) );

            if ( this.state != BackgroundTaskState.Running ) {
                return;
            }
            
            let child = spawn( this.driver.getCommandPath(), args );

            this.process = child;

            child.on( 'error', error => console.error( error ) );
            
            let lastSegment : number = this.segment.start;

            child.stderr.on( 'data', d => {
                const lines = d.toString().split( '\n' ).map( l => l.trim() ).filter( l => l );
                
                for ( let line of lines ) {
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