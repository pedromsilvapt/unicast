import { Synchronized } from 'data-semaphore';
import { Lifetime } from '../../../ES2017/Lifetime';
import * as jayson from 'jayson';
import { PlayableMediaRecord, TvShowMediaRecord, MovieMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord } from '../../../MediaRecord';
import { CircuitBreaker } from '../../../ES2017/Resilient';
import { stringify } from 'querystring';

export interface KodiActivePlayer {
    playerid: number;
    playertype: 'internal';
    type: 'video';
}

export interface PlayOptions {
    autoStart ?: boolean;
    startTime ?: number;
}

function timeToSeconds ( time : { hours: number, minutes: number, seconds: number, milliseconds: number } ) : number {
    if ( time == null ) return 0;

    return ( time.hours * 60 * 60 )
         + ( time.minutes * 60 )
         + time.seconds
         + ( time.milliseconds / 1000 )
}

export class KodiConnection {
    public readonly address : string;

    public readonly port : number;

    public readonly username : string;

    public readonly password : string;

    public readonly fallback : string;

    public readonly pages : KodiDefaultPages;

    public usingFallback : boolean = false;

    public failedAttemptsAtConnecting : number = 0;

    protected client : jayson.HttpClient = null;

    protected clientLifetime : Lifetime = null;

    constructor ( address : string, port : number, username : string = null, password : string = null, fallback : string = null ) {
        this.address = address;
        this.port = port;
        this.username = username;
        this.password = password;
        this.fallback = fallback;

        this.pages = new KodiDefaultPages( this );
    }

    public get connected () {
        return this.client != null;
    }

    protected request<T> ( method : string, args : any = {} ) : Promise<T> {
        return new Promise( ( resolve, reject ) => {
            this.client.request( method, args, ( err, response ) => {
                if ( err ) return reject( err );

                resolve( response.result );
            } );
        } );
    }

    @Synchronized()
    async open () {
        const address = this.usingFallback ? this.fallback : this.address;

        this.client = jayson.Client.http( {
            hostname: address,
            port: this.port,
            path: '/jsonrpc',
            headers: this.username != null ? {
                'Authorization': 'Basic ' + Buffer.from( this.username + ':' + this.password ).toString( 'base64' )
            } : void 0
        } );
    }

    protected useFallback ( err : any ) : boolean {
        if ( err && ( err.code == 'ECONNREFUSED' || err.code == 'ETIMEDOUT' || err.code == 'EHOSTUNREACH' ) ) {
            this.failedAttemptsAtConnecting += 1;

            if ( this.failedAttemptsAtConnecting > 1 || this.fallback == null ) {
                return false;
            }

            this.usingFallback = !this.usingFallback;

            return true;
        }

        return false;
    }

    close () {
        if ( this.client != null && this.clientLifetime != null ) {
            this.clientLifetime.close();
        }

        this.clientLifetime = null;

        this.client = null;
    }

    async call <R = void>( command : string, args : any = {} ) : Promise<R> {
        while ( !this.connected ) {
            try {
                await this.open();

                this.failedAttemptsAtConnecting = 0;
            } catch ( err ) {
                if ( this.useFallback( err ) ) {
                    this.close();
                } else {
                    this.failedAttemptsAtConnecting = 0;

                    throw err;
                }
            }
        }

        try {
            const result = await this.request<R>( command, args );

            this.failedAttemptsAtConnecting = 0;

            return result;
        } catch ( err ) {
            if ( this.useFallback( err ) ) {
                this.close();

                return this.call( command, args );
            }

            if ( err && err.message && err.message.includes( 'socket not ready' ) ) {
                this.close();

                return this.call( command, args );
            }

            this.failedAttemptsAtConnecting = 0;

            if ( err && err.message ) {
                throw new Error( this.address + ' ' + command + ' ' + err.message + ': ' + ( err.data || '' ) );
            } else if ( err && err.errcode ) {
                throw new Error( this.address + ' ' + command + ' ' + err.errcode + ' ' + err.errmessage + ': ' + ( err.method || '' ) );
            } else {
                throw new Error( this.address + ' ' + command + ' ' + err );
            }
        }
    }

    getActivePlayers () : Promise<KodiActivePlayer[]> {
        return this.call( 'Player.GetActivePlayers', {} );
    }

    async getActiveVideoPlayer () : Promise<KodiActivePlayer> {
        const activePlayers = await this.getActivePlayers();

        return activePlayers.find( player => player.type === 'video' );
    }

    play ( record : PlayableMediaRecord, options : PlayOptions = {} ) : Promise<void> {
        const file = `plugin://plugin.video.unicast/play/${ record.kind }/${ record.id }`;

        return this.call( 'Player.Open', { item: { file } } );
    }

    playSession ( session : string, options : PlayOptions = {} ) : Promise<void> {
        const file = `plugin://plugin.video.unicast/play-session/${ session }`;

        return this.call( 'Player.Open', { item: { file } } );
    }

    async pause () : Promise<void> {
        const player = await this.getActiveVideoPlayer();

        if ( player != null ) return this.call( 'Player.PlayPause', { playerid: player.playerid, play: false } );
    }

    async resume () : Promise<void> {
        const player = await this.getActiveVideoPlayer();

        if ( player != null ) return this.call( 'Player.PlayPause', { playerid: player.playerid, play: true } );
    }

    async stop () : Promise<void> {
        const player = await this.getActiveVideoPlayer();

        if ( player != null ) return this.call( 'Player.Stop', { playerid: player.playerid } );
    }

    async status () : Promise<any> {
        const player = await this.getActiveVideoPlayer();

        if ( player == null ) return null;

        const properties = await this.call<any>( 'Player.GetProperties', { playerid: player.playerid, properties: [ 'speed', 'time', 'totaltime', 'percentage' ] } );

        if ( !properties ) return null;

        const totalTime = timeToSeconds( properties.totaltime );

        if ( totalTime == 0 ) return null;

        const appProperties = await this.call<any>( 'Application.GetProperties', { properties: [ 'muted', 'volume' ] } );

        return {
            speed: properties.speed,
            time: timeToSeconds( properties.time ),
            totalTime: totalTime,

            pause: properties.speed == 0,
            volume: appProperties.volume,
            mute: appProperties.muted,
            subScale: 1
        }
    }

    async seekRelative ( time : number ) : Promise<void> {
        const player = await this.getActiveVideoPlayer();

        if ( player != null ) await this.call( 'Player.Seek', { playerid: player.playerid, value: { seconds: Math.round( time ) } } );
    }

    async seek ( time : number ) : Promise<void> {
        const player = await this.getActiveVideoPlayer();

        if ( player != null ) {
            const properties = await this.call<any>( 'Player.GetProperties', { playerid: player.playerid, properties: [ 'time' ] } );

            await this.call( 'Player.Seek', { playerid: player.playerid, value: { seconds: Math.round( time - timeToSeconds( properties.time ) ) } } );
        }
    }

    mute () : Promise<void> {
        return this.call( 'Application.SetMute', { mute: true } );
    }

    unmute () : Promise<void> {
        return this.call( 'Application.SetMute', { mute: false } );
    }

    volume ( level : number ) : Promise<void> {
        return this.call( 'Application.SetVolume', { volume: level } );
    }

    subtitleDelayPlus () : Promise<void> {
        return this.call( 'Input.ExecuteAction', { action: 'subtitledelayplus' } );
    }

    subtitleDelayMinus () : Promise<void> {
        return this.call( 'Input.ExecuteAction', { action: 'subtitledelayminus' } );
    }

    audioDelayPlus () : Promise<void> {
        return this.call( 'Input.ExecuteAction', { action: 'audiodelayplus' } );
    }

    audioDelayMinus () : Promise<void> {
        return this.call( 'Input.ExecuteAction', { action: 'audiodelayminus' } );
    }

    subtitleScale ( scale : number ) : Promise<void> {
        return this.call( 'subtitleScale', scale );
    }

    setMultipleProperties ( properties : any ) : Promise<void> {
        return this.call( 'setMultipleProperties', properties );
    }

    showProgress () {
        return this.call( 'Input.ShowOSD' );
    }

    getGuiProperty ( property : "currentwindow" ) : Promise<GUIProperties.CurrentWindow>;
    getGuiProperty ( property : "currentcontrol" ) : Promise<GUIProperties.CurrentControl>;
    getGuiProperty ( property : "skin" ) : Promise<GUIProperties.Skin>;
    getGuiProperty ( property : "fullscreen" ) : Promise<GUIProperties.Fullscreen>;
    getGuiProperty ( property : "stereoscopicmode" ) : Promise<GUIProperties.StereoscopicMode>;
    getGuiProperty ( property : string ) : Promise<GUIProperties.Any>;
    async getGuiProperty ( property : string ) : Promise<GUIProperties.Any> {
        return ( await this.call( 'GUI.GetProperties', { properties: [ property ] } ) )[ property ];
    }

    public async sendSetServerAddress ( address : string, port : number ) : Promise<void> {
        this.call( 'JSONRPC.NotifyAll', {
            sender: 'unicast',
            'message': `PluginVideoUnicast.SetServerAddress`,
            data: {
                address: address,
                port: port
            }
        } );
    }

    quit () : Promise<void> {
        return this.call( 'System.Shutdown' );
    }
}

export namespace GUIProperties {
    export interface CurrentWindow {
        id: number;
        label: string;
    }

    export interface CurrentControl {
        label: string;
    }

    export interface Skin {
        id: string;
        name: string;
    }

    export type Fullscreen = boolean;

    export interface StereoscopicMode {
        label: string;
        mode: 'on' | 'off';
    }

    export type Any = CurrentWindow | CurrentControl | Skin | Fullscreen | StereoscopicMode;
}

export enum KodiListOrientation {
    Vertical,
    Horizontal,
}

export class KodiDefaultPages {
    protected connection: KodiConnection;

    constructor ( connection : KodiConnection ) {
        this.connection = connection;
    }

    // Unnecessary now since the unicast kodi plugin is able to better handle
    // auto-selection more elegantly
    protected async selectItem (
        pageId : number,
        listOrientation : KodiListOrientation,
        itemLabel: string,
        allItems: string[] = null
    ) {
        const itemIndex = allItems?.findIndex( label => itemLabel === label ) + 1;

        // If the page already has some item selected, we need to know if we
        // want to go backwards or forwards
        let hasOptimalDirection = false;
        // Forward is Right/Down, Backwards is Left/Up
        let optimalDirectionForward = true;

        await new CircuitBreaker( {
            delay: 200,

            // Roughly 4 seconds
            maxAttempts: 20,

            action: async () => {
                const currentWindow = await this.connection.getGuiProperty( "currentwindow" );

                if ( currentWindow.id !== pageId ) {
                    throw new Error( `Can't select item. Reason: incorrect window, expected ${ pageId }, actual ${ currentWindow.id }.` );
                }

                let currentControl = await this.connection.getGuiProperty( "currentcontrol" );

                if ( currentControl.label === itemLabel ) {
                    return;
                }

                let times = 200;

                if ( allItems != null ) {
                    const currentIndex = currentControl.label !== '[..]'
                        ? allItems.findIndex( item => item === currentControl.label ) + 1
                        : 0;

                    if ( currentIndex < 0 ) {
                        throw new Error( `Current control not found in all items list.` );
                    }

                    const dst = Math.abs( currentIndex - itemIndex );

                    optimalDirectionForward = allItems.length + 1 - dst > dst;

                    times = optimalDirectionForward ? dst : allItems.length + 1 - dst;

                    // If the selected index is after the one we want to select
                    // the optimal direction is the opposite
                    if ( currentIndex > itemIndex ) {
                        optimalDirectionForward = !optimalDirectionForward;
                    }
                }

                let inputDirection = optimalDirectionForward
                    ? ( listOrientation == KodiListOrientation.Horizontal ? 'Right' : 'Down' )
                    : ( listOrientation == KodiListOrientation.Horizontal ? 'Left' : 'Up' );

                for ( let i = 0; i < times; i++ ) {
                    await this.connection.call( 'Input.' + inputDirection, {} );

                    if ( allItems == null ) {
                        await new Promise( resolve => setTimeout( resolve, 200 ) );

                        currentControl = await this.connection.getGuiProperty( "currentcontrol" );

                        if ( currentControl.label === itemLabel ) {
                            break;
                        }
                    }
                }

                if ( allItems != null ) {
                    await new Promise( resolve => setTimeout( resolve, 200 ) );

                    currentControl = await this.connection.getGuiProperty( "currentcontrol" );

                    if ( currentControl.label !== itemLabel ) {
                        throw new Error( `Incorrect control` );
                    }
                }
            }
        } ).run();
    }

    public async openAddon ( path : string = '/', params: any = null ) : Promise<string> {
        if ( params != null ) {
            path = path + '?' + stringify( params );
        }

        await this.connection.call( 'Addons.ExecuteAddon', { wait: true, addonid: 'plugin.video.unicast', params: path } );

        return 'plugin://plugin.video.unicast' + path;
    }

    public async sendAutoSelect ( page_path: string, item: string ) : Promise<void> {
        this.connection.call( 'JSONRPC.NotifyAll', {
            sender: 'unicast',
            'message': `PluginVideoUnicast.AutoSelect`,
            data: {
                page: page_path,
                selectedItem: item
            }
        } );
    }

    public async openSingleMovieList ( record : MovieMediaRecord ) {
        const path = await this.openAddon( `/movies/single/${ record.id }` );

        await this.sendAutoSelect( path, record.title );
    }

    public async openSingleTvShowList ( record : TvShowMediaRecord ) {
        const path = await this.openAddon( `/tvshows/single/${ record.id }` );

        await this.sendAutoSelect( path, record.title );
    }

    public async openTvShow ( record : TvShowMediaRecord, options : TvShowPageOptions = {} ) {
        const path = await this.openAddon( `/tvshows/${ record.id }/seasons` );

        if ( options.selectedSeason ) {
            await this.sendAutoSelect( path, `Season ${options.selectedSeason.number}` );
        }
    }

    public async openTvSeason ( record : TvSeasonMediaRecord, options : TvSeasonPageOptions = {} ) {
        const path = await this.openAddon( `/tvseasons/${ record.id }/episodes` );

        if ( options.selectedEpisode ) {
            await this.sendAutoSelect( path, options.selectedEpisode.title );
        }
    }
}

export interface TvShowPageOptions {
    selectedSeason?: TvSeasonMediaRecord;
}

export interface TvSeasonPageOptions {
    selectedEpisode?: TvEpisodeMediaRecord;
}
