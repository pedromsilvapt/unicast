import { DefaultMediaReceiver } from 'castv2-client';
import { GeneralRemote } from './General';
import promisify from 'es6-promisify';

export default class DefaultMediaRemote extends GeneralRemote {
    application = DefaultMediaReceiver;

    playing : boolean = false;

    lastSubtitlesStyle : any = null;

    seekTo ( newCurrentTime : number ) {
        return this.callPlayerMethod( 'seek', [ newCurrentTime ] );
    }

    /** Seeks in seconds relative to currentTime
     *
     * @param offsetSeconds     The number of seconds to add/subtract to the current position
     * @returns                 A promise resolved when the command executes
     */
    async seek ( offsetSeconds : number ) {
        const status = await this.getStatus();

        const newCurrentTime : number = status.currentTime + offsetSeconds;

        return this.seekTo( newCurrentTime );
    }

    setVolume ( volume : number ) {
        return this.callClientMethod( 'setVolume', [ { level: volume } ] );
    }

    setVolumeMuted ( muted : boolean = true ) {
        return this.callClientMethod( 'setVolume', [ { muted: muted } ] );
    }

    async load ( media : any, options : any = {} ) {
        let status = await this.callPlayerMethod( 'load', [ media, options ], [ 'playing' ] );

        if ( media.textTrackStyle ) {
            this.lastSubtitlesStyle = media.textTrackStyle;
        }

        this.playing = true;

        this.emit( 'played', media );

        return status;
    }

    pause () {
        this.playing = false;

        return this.callPlayerMethod( 'pause', [], [ 'pausing', 'paused' ] );
    }

    resume () {
        this.playing = true;

        return this.callPlayerMethod( 'play', [], [ 'resuming', 'resumed' ] );
    }

    stop () {
        this.playing = false;

        return this.callPlayerMethod( 'stop', [], [ 'stopping', 'stopped' ] );
    }

    subtitlesOff () {
        return this.callPlayerMethod( 'media.sessionRequest', [ {
            type: 'EDIT_TRACKS_INFO',
            activeTrackIds: []
        } ] );
    }

    changeSubtitles ( index : number ) {
        this.callPlayerMethod( 'media.sessionRequest', [ {
            type: 'EDIT_TRACKS_INFO',
            activeTrackIds: [ index ]
        } ] );
    }

    async changeSubtitlesSize ( size : number ) {
        if ( !this.lastSubtitlesStyle || !this.playing ) {
            return false;
        }

        let style = this.lastSubtitlesStyle;

        style.fontScale = size;

        return this.callPlayerMethod( 'media.sessionRequest', [ {
            type: 'EDIT_TRACKS_INFO',
            textTrackStyle: style
        } ] );
    }
}