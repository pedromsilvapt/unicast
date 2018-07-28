// mpv --script="${script}" "${video}" --sub-file="${subtitle}" --fullscreen=yes

function seek ( time ) {
    mp.set_property_number( 'playback-time', Math.max( 0, time ) / 1000 );
}

function currentTime () {
    return mp.get_property_number( 'playback-time' ) * 1000;
}

function quit () {
    mp.command( 'quit' );
}

function id ( value ) {
    return value || [];
}

function delay ( time ) {
    if ( typeof time !== 'number' ) {
        return mp.get_property_number( 'sub-delay' ) * 1000;
    }
    
    mp.set_property_number( 'sub-delay', ( delay() + time ) / 1000 );
}

function BinarySearch ( start, end ) {
    this.start = start;
    this.end = end;
}

BinarySearch.prototype.found = function () {
    return this.start == this.end;
}

BinarySearch.prototype.needle = function () {
    return this.start + Math.floor( ( this.end - this.start ) / 2 );
}

BinarySearch.prototype.goLeft = function ( needle ) {
    this.end = needle;

    return this;
}

BinarySearch.prototype.goRight = function ( needle ) {
    this.start = needle;

    return this;
}

BinarySearch.prototype.clone = function () {
    return new BinarySearch( this.start, this.end );
}

function DelayMapping () {
    this.delays = {};
}

DelayMapping.prototype.set = function ( index, delay ) {
    this.delays[ index ] = delay;

    return this;
}

DelayMapping.prototype.get = function ( index ) {
    if ( index in this.delays ) {
        return this.delays[ index ];
    }

    var max = -1;

    Object.keys( this.delays ).forEach( function ( key ) {
        if ( key <= index && key > max ) {
            max = key;
        }
    } );

    if ( max >= 0 ) {
        return this.delays[ max ];
    }

    return 0;
}

DelayMapping.prototype.increase = function ( index, delay ) {
    this.set( index, this.get( index ) + delay );

    return this;
}

/*
 * WORKFLOW:
 * $RANGE is equal to [ 0, lines.length ]
 * 
 * $MODE == SEEK
 * Using a binary search through range, find a unsynchronized lines.
 *   - Loop over the same subtitle until the user presses [y] synchronized or [n] not synchronized
 *   - When an unsynchronized line is found, enter $MODE = SYNC
 * 
 * $MODE == SYNC
 * Keep looping in the same line until the user presses [y] to signal synchronization.
 * Allow the user to select 
 */

var lines = id( __lines__ );

var outputFile = __output__;

var padd = 1000;

var delayMapping = new DelayMapping();

var timeRange = { start: 0, end: 0 };

var eventLoopInterval = null;

var eventLoopWait = 100;

var hasFileLoaded = false;

// DIRECTION
var RIGHT = 1;
var LEFT = 2;

// MODE
var INIT = 0;
var SEEK = 1;
var SYNC = 2;

// ACTION
var NONE = 0;
var APPROVED = 1;
var REJECTED = 2;

// Each history item will contain {}
var history = [ { mode: INIT, action: NONE, direction: RIGHT, line: 0, delay: 0, range: new BinarySearch( 0, lines.length - 1 ), user: false } ];

function mode () {
    return history[ history.length - 1 ].mode;
}

function action () {
    return history[ history.length - 1 ].action;
}

function direction () {
    return history[ history.length - 1 ].direction;
}

function line () {
    return history[ history.length - 1 ].line;
}

function range () {
    return history[ history.length - 1 ].range;
}

function pushHistory ( mode, action, direction, line, delay, range, user ) {
    var oldState = peekHistory();

    var state = { mode: mode, action: action, direction: direction, line: line, delay: delay, range: range, user: user };
        
    history.push( state );

    dump( 'PUSH HISTORY', mode, action, line, oldState.mode, oldState.action, oldState.line );

    if ( line != oldState.line ) {
        goToLine( line );
    } else {
        updateTimeRange();
    }

    updateStatus();
}

function peekHistory () {
    return history[ history.length - 1 ];
}

function popHistory () {
    while ( history.length > 1 && !peekHistory().user ) history.pop();

    if ( history.length > 1 ) {
        var oldState = history.pop();

        if ( peekHistory().delay != oldState.delay ) {
            var diff = peekHistory().delay - oldState.delay;

            delayMapping.increase( peekHistory().line, diff );

            delay( diff );
        }
    
        goToLine( line() );
    
        updateStatus();
    }
}

function ls ( index ) {
    return lines[ index ].start + delayMapping.get( index );
}

function le ( index ) {
    return lines[ index ].end + delayMapping.get( index );
}

function updateTimeRange () {
    timeRange.start = ls( displayingLineIndex );
    timeRange.end = le( displayingLineIndex );
}

var displayingLineIndex = -1;

function goToLine ( index ) {
    if ( index != displayingLineIndex && index >= range().start && index <= range().end ) {
        displayingLineIndex = index;

        updateTimeRange();

        seek( timeRange.start - padd );
    }
}

function onNextSub () {
    goToLine( displayingLineIndex + 1 );
}

function onPrevSub () {
    goToLine( displayingLineIndex - 1 );
}

function onAcceptKey () {
    pushHistory( mode(), APPROVED, direction(), line(), delay(), range(), true );
}

function onRejectKey () {
    if ( mode() == SEEK ) {
        pushHistory( mode(), REJECTED, direction(), line(), delay(), range(), true );
    }
}

function onDelayAdd () {
    if ( mode() == SYNC ) {
        // range.start is the index of the binary search
        delayMapping.increase( range().start, 250 );

        pushHistory( mode(), action(), direction(), line(), delay( 250 ), range(), true );
    }
}

function onDelaySub () {
    if ( mode() == SYNC ) {
        // range.start is the index of the binary search
        delayMapping.increase( range().start, -250 );
    
        pushHistory( mode(), action(), direction(), line(), delay( -250 ), range(), true );
    }
}

function onUndo () {
    popHistory();
}

function saveAndQuit () {
    dump( delayMapping.delays );

    if ( outputFile != null ) {
        mp.utils.write_file( 'file://' + outputFile, JSON.stringify( delayMapping.delays ) );
    }

    quit();
}

function updateStatus () {
    if ( mode() == SEEK ) {
        dir = direction() == RIGHT ? '»' : '«';

        mp.osd_message( dir + " SEEK " + range().start + " " + range().end + " ( " + delay() + "ms )", 2000 );
    } else if ( mode() == SYNC ) {
        mp.osd_message( "SYNC " + range().start + " ( " + delay() + "ms )", 2000 );
    }
}

function seekLeft () {
    var newRange = range().clone().goLeft( displayingLineIndex );

    if ( newRange.found() ) {
        sync();
    } else {
        pushHistory( SEEK, NONE, LEFT, newRange.needle(), delay(), newRange, false );
    }
}

function seekRight () {
    var newRange = range().clone().goRight( displayingLineIndex + 1 );

    // When approved, either the search is:
     // - finished
     // - or not
    // If it is, (because seekRight is only called on approvals), we want to seek the next line (after all this one was approved)
    // If it is not finished, then we want to push the new state anyways, to continue seeking, so the pushHistory is always called
    // (unlike on seekLeft, where it is only called when the search is **not** finished).
    pushHistory( SEEK, NONE, RIGHT, newRange.needle(), delay(), newRange, false );

    if ( newRange.found() ) {
        if ( newRange.end == lines.length - 1 ) {
            saveAndQuit();
        } else {
            sync();
        }
    }
}

function sync () {
    pushHistory( SYNC, NONE, RIGHT, range().start, delay(), new BinarySearch( range().start, lines.length - 1 ), false );
    
    goToLine( range().start );

    updateStatus();
    
    return;
}

function onIteration () {
    if ( mode() == INIT ) {
        if ( range().start == range().end ) {
            // Should never do this on INIT, only if no subtitle lines are provided
            return quit();
        }

        goToLine( 0 );

        pushHistory( SEEK, NONE, RIGHT, 0, 0, range(), false );
    } else if ( mode() == SEEK ) {
        if ( !action() && currentTime() > timeRange.end + padd ) {
            seek( timeRange.start - padd );
        } else if ( action() == APPROVED ) {
            seekRight();
        } else if ( action ()== REJECTED ) {
            seekLeft();
        }
    } else if ( mode() == SYNC ) {
        if ( !action() && currentTime() > timeRange.end + padd ) {
            seek( timeRange.start - padd );
        } else if ( action() == APPROVED ) {
            seekRight();
        }
    }

    if ( !eventLoopInterval ) {
        eventLoopInterval = setInterval( onIteration, eventLoopWait );
    }
}

function onPauseChange ( value ) {
    if ( value && eventLoopInterval ) {
        clearInterval( eventLoopInterval );

        eventLoopInterval = null;
    } else if ( !value && hasFileLoaded ) {
        onIteration();
    }
}

function onFileLoad () {
    hasFileLoaded = true;

    onIteration();
}

mp.observe_property( 'pause', 'bool', onPauseChange );

mp.register_event( 'file-loaded', onFileLoad );

mp.add_key_binding( 'y', onAcceptKey );
mp.add_key_binding( 'n', onRejectKey );
mp.add_key_binding( 'h', onDelaySub );
mp.add_key_binding( 'j', onDelayAdd );
mp.add_key_binding( 'Ctrl+h', onPrevSub );
mp.add_key_binding( 'Ctrl+j', onNextSub );
mp.add_key_binding( 'Ctrl+z', onUndo );