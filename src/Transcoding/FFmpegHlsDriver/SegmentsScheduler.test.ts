import { SegmentsMap } from "./SegmentsMap";
import { SegmentsScheduler, SegmentsSchedulerJob } from "./SegmentsScheduler";

const test = require('blue-tape');
var tapSpec = require('tap-spec');

test( "SegmentsMap: insert", ( t ) => {
    const map = new SegmentsMap<any>( 100, 1 );

    const scheduler = new SegmentsScheduler<any>( map );

    let startJobEventCounter : number = 0;
    let stopJobEventCounter : number = 0;

    t.plan( 3 + 3 );
    // TODO Change to 4 and implement auto start future jobs when the current one has finished and there are no more requests on the queue 
    // t.plan( 4 + 3 );

    scheduler.on( 'stop-job', ( job : SegmentsSchedulerJob ) => {
        switch ( stopJobEventCounter++ ) {
            case 0:
                t.deepEqual( job.segment, { start: 0, end: 100 } );
                break;
            case 1:
                t.deepEqual( job.segment, { start: 50, end: 100 } );
                break;
            case 2:
                t.deepEqual( job.segment, { start: 45, end: 49 } );
                break;
            default:
                t.fail( 'Stop job called too many times.' );
        }
    } );

    scheduler.on( 'start-job', ( job : SegmentsSchedulerJob ) => {
        switch ( startJobEventCounter++ ) {
            case 0:
                t.deepEqual( job.segment, { start: 0, end: 100 } );
                break;
            case 1:
                t.deepEqual( job.segment, { start: 50, end: 100 } );
                break;
            case 2:
                t.deepEqual( job.segment, { start: 45, end: 49 } );
                break;
            // case 3:
                // t.deepEqual( job.segment, { start: 52, end: 100 } );
                // break;
            default:
                t.fail( 'Start job called too many times.' );
        }
    } );

    scheduler.request( 0 );
    scheduler.request( 1 );
    scheduler.request( 2 );

    scheduler.insert( 0, true );
    scheduler.insert( 1, true );
    scheduler.insert( 2, true );

    scheduler.request( 50 );

    scheduler.insert( 50, true );
    scheduler.insert( 51, true );
    scheduler.insert( 52, true );

    scheduler.request( 45 );

    scheduler.insert( 45, true );
    scheduler.insert( 46, true );
    scheduler.insert( 47, true );
    scheduler.insert( 48, true );
    scheduler.insert( 49, true );
} );
