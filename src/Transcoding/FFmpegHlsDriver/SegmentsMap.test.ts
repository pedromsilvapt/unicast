import { SegmentsMap } from "./SegmentsMap";

const test = require('blue-tape');
var tapSpec = require('tap-spec');

test( "SegmentsMap: insert", ( t ) => {
    const map = new SegmentsMap<any>( Infinity, 10 );

    t.equal( map.has( 0 ), false );
    t.equal( map.has( 10 ), false );
    t.equal( map.has( 5 ), false );
    
    map.insert( 0, {} );
    t.equal( map.has( 0 ), true );
    t.equal( map.has( 1 ), false );

    map.insert( 2, {} );
    t.equal( map.has( 2 ), true );
    
    map.insert( 1, {} );
    t.equal( map.has( 1 ), true );
    

    t.deepEqual( map.findNextEmpty( 0 ), { start: 3, end: Infinity } );
    t.deepEqual( map.findNextEmpty( 0 ), { start: 3, end: Infinity } );

    map.insert( 5, {} );
    t.equal( map.has( 5 ), true );

    t.deepEqual( Array.from( map.segments() ), [ { start: 0, end: 2 }, { start: 5, end: 5 } ] );
    t.deepEqual( Array.from( map.empty() ), [ { start: 3, end: 4 }, { start: 6, end: Infinity } ] );

    t.end();
} );