import { DefaultMediaReceiver } from 'castv2-client';
import { GeneralRemote } from './General';

export default class DefaultMediaRemote extends GeneralRemote {
    application = DefaultMediaReceiver;

    playing : boolean = false;

    async checkMediaSession () {
        if ( !this.player.native.media.currentSession ) {
            await this.getStatus();
        }
    }

    async seekTo ( newCurrentTime : number ) : Promise<void> {
        this.isOpened || await this.open();
        
        await this.checkMediaSession();
        
        await this.player.seek( newCurrentTime );
    }

    /** Seeks in seconds relative to currentTime
     *
     * @param offsetSeconds     The number of seconds to add/subtract to the current position
     * @returns                 A promise resolved when the command executes
     */
    async seek ( offsetSeconds : number ) : Promise<void> {
        const status = await this.getStatus();

        const newCurrentTime : number = status.currentTime + offsetSeconds;

        return this.seekTo( newCurrentTime );
    }

    async setVolume ( level : number ) {
        this.isConnected || await this.connect();
        
        return this.client.setVolume( { level } );
    }

    async setVolumeMuted ( muted : boolean = true ) {
        this.isConnected || await this.connect();

        return this.client.setVolume( { muted } );
    }

    async load ( media : any, options : any = {} ) {
        this.isOpened || await this.open();

        let status = await this.player.load( media, options );

        this.playing = true;

        this.emit( 'played', media );

        return status;
    }

    async pause () {
        this.isOpened || await this.open();

        this.playing = false;

        await this.checkMediaSession();
        
        return this.player.pause();
    }

    async resume () {
        this.isOpened || await this.open();

        this.playing = true;
        
        await this.checkMediaSession();
        
        return this.player.play();
    }

    async stop () {
        this.isOpened || await this.open();
        
        this.playing = false;

        await this.checkMediaSession();
        
        return this.player.stop();
    }

    async subtitlesOff () {
        this.isOpened || await this.open();

        await this.checkMediaSession();

        await this.player.disableSubtitles();
    }

    async changeSubtitles ( index : number ) {
        this.isOpened || await this.open();
        
        await this.checkMediaSession();
        
        await this.player.setActiveSubtitles( index );
    }

    async changeSubtitlesStyle ( style : any ) {
        if ( !this.playing ) {
            return false;
        }

        this.isOpened || await this.open();        

        await this.checkMediaSession();

        await this.player.setSubtitlesStyle( style );
    }
}