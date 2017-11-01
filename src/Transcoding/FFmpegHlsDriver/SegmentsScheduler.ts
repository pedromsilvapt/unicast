import { SegmentsMap, Segment } from "./SegmentsMap";
import { EventEmitter } from "events";
import { CancelToken } from "../../ES2017/CancelToken";
import { isAfter } from 'date-fns';
import * as sortBy from 'sort-by';

export class SegmentsScheduler<T> extends EventEmitter {
    map : SegmentsMap<T>;
    
    protected fullJobsCounter : number = 0;

    concurrentJobs : number = 1;

    concurrentGreedyJobs : number = 1;

    jobs : SegmentsSchedulerJob[] = [];

    jobWaitingWindow : number = 10;

    constructor ( map : SegmentsMap<T> ) {
        super();

        this.map = map;
    }

    findJobFor ( index : number ) : SegmentsSchedulerJob {
        return this.jobs.find( job => job.within( index ) );
    }

    insert ( index : number, value : T ) {
        if ( !this.map.has( index ) ) {
            this.map.insert( index, value );
        
            const job = this.findJobFor( index );

            if ( job ) {
                job.missing -= 1;

                if ( job.missing === 0 ) {
                    this.emit( 'stop-job', job );
                }
            }
        }
    }

    createJob ( segment : Segment, cancel ?: CancelToken ) {
        const job = new SegmentsSchedulerJob( segment );

        job.number = this.fullJobsCounter++;

        job.on( 'request-changed', () => this.resort() );

        this.jobs.push( job );

        job.request( segment.start, cancel );

        this.emit( 'start-job', job );

        this.resort();
    }

    protected resort () {
        this.jobs.sort( sortBy( '-number' ) );

        let removed : SegmentsSchedulerJob[] = [];

        this.jobs = this.jobs.filter( ( job, index ) => {
            if ( index + 1 > this.concurrentJobs ) {
                removed.push( job );
                
                return false;
            } else if ( index + 1 > this.concurrentGreedyJobs && job.requests.size > 0 ) {
                removed.push( job );

                return false;
            }

            return true;
        } );

        for ( let job of removed.reverse() ) {
            this.emit( 'cancel-job', job );
        }
    }

    request ( index : number, cancel ?: CancelToken ) {
        const nextEmpty = this.map.findNextEmpty( index );

        if ( !nextEmpty ) {
            return false;
        }

        let rightJobForTheJob : SegmentsSchedulerJob = null;

        for ( let job of this.jobs ) {
            if ( job.withinWindow( nextEmpty.start, this.jobWaitingWindow ) ) {
                job.request( nextEmpty.start, cancel );

                job.number = this.fullJobsCounter++;

                rightJobForTheJob = job;

                break;
            }
        }

        if ( !rightJobForTheJob ) {
            this.createJob( nextEmpty );
        }
    }
}

export class SegmentsSchedulerJob extends EventEmitter {
    id : string;

    number : number;

    segment : Segment;

    missing : number;

    get lastSegmentDone () : number {
        return this.segment.end - this.missing + 1;
    }

    lastSegmentRequested : number = null;

    lastSegmentRequestedDate : Date = null;

    requests : Map<number, Date> = new Map();

    constructor ( segment : Segment ) {
        super();

        this.segment = segment;    

        this.missing = segment.end - segment.start + 1;
    }

    within ( index : number ) : boolean {
        return this.segment.start <= index && this.segment.end >= index;
    }

    withinWindow ( index : number, windowSize : number ) : boolean {
        return this.within( index ) && this.lastSegmentDone + windowSize >= index;
    }

    insert ( index : number ) : void {
        for ( let [ requestIndex, date ] of this.requests ) {
            if ( index === requestIndex ) {
                this.requests.delete( requestIndex );

                if ( this.lastSegmentRequested === index ) {
                    this.flushRequests();
                } else {
                    this.emit( 'request-changed' );                    
                }
                
                break;
            }
        }
    }

    request ( index : number, cancel ?: CancelToken ) {
        const date = new Date();

        this.lastSegmentRequested = index;
        this.lastSegmentRequestedDate = date;

        this.requests.set( this.lastSegmentRequested, this.lastSegmentRequestedDate );

        if ( cancel ) {
            cancel.whenCancelled().then( () => {
                this.requests.delete( index );

                if ( index === this.lastSegmentRequested ) {
                    this.flushRequests();
                }
            } );
        }
    }

    protected flushRequests () {
        this.lastSegmentRequested = null;
        this.lastSegmentRequestedDate = null;

        for ( let [ index, date ] of this.requests ) {
            if ( this.lastSegmentRequestedDate === null || isAfter( date, this.lastSegmentRequestedDate ) ) {
                this.lastSegmentRequested = index;
                this.lastSegmentRequestedDate = date;
            }
        }

        this.emit( 'request-changed' );
    }
}
