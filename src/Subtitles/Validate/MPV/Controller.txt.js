//  D:\Programs\mpv\mpv.com --script="D:\Pedro Silva\Documents\Projects\Node\unicast\src\Subtitles\Validate\MPV\Controller.txt.js" "D:\Pedro Silva\Videos\AnnMarieCox.mp4" --sub-file="D:\Pedro Silva\Videos\The Fallen.vtt" --fullscreen=yes

function seek ( time ) {
    mp.set_property_number( 'playback-time', time / 1000 );
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

var timestamps = id( __timestamps__ );

var timestampsIndex = 0;

var isPaused = false;

var timeoutToken = null;

function playNextTimestamp () {
    timestampsIndex++;

    if ( timestampsIndex >= timestamps.length ) {
        quit();
    } else {
        playTimestamp( timestampsIndex );
    }
}

function setPlayNextTimestamp ( index ) {
    this.timeoutToken = setTimeout( function () {
        this.timeoutToken = null;

        playNextTimestamp();
    }, timestamps[ index ].end - currentTime() );
}

function playTimestamp ( index ) {
    seek( timestamps[ index ].start );

    setTimeout( function () {
        if ( !isPaused ) {
            setPlayNextTimestamp( index );
        }
    }, 100 );

}

function startValidationTour () {
    if ( timestamps.length > 0 ) {
        playTimestamp( timestampsIndex );
    }    
}

function onPauseChange ( name, value ) {
    if ( isPaused === value ) {
        return;
    }
    
    isPaused = value;

    if ( isPaused ) {
        if ( this.timeoutToken ) {
            clearTimeout( this.timeoutToken );
        }
    } else {
        setPlayNextTimestamp( timestampsIndex );        
    }
}

function onSeekChange () {

}

function onFileLoad () {
    startValidationTour();
}

mp.observe_property( 'pause', 'bool', onPauseChange );

mp.register_event( 'file-loaded', onFileLoad );