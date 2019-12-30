import { Synchronized } from 'data-semaphore';
import { Lifetime } from '../../../ES2017/Lifetime';
import * as jayson from 'jayson';
import { PlayableMediaRecord, MediaKind } from '../../../MediaRecord';

export interface KodiActivePlayer {
    playerid: number;
    playertype: 'internal';
    type: 'video';
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

    protected client : jayson.HttpClient = null;

    protected clientLifetime : Lifetime = null;

    constructor ( address : string, port : number, username : string = null, password : string = null ) {
        this.address = address;
        this.port = port;
        this.username = username;
        this.password = password;
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
        this.client = jayson.Client.http( {
            hostname: this.address,
            port: this.port,
            path: '/jsonrpc',
            headers: this.username != null ? {
                'Authorization': 'Basic ' + Buffer.from( this.username + ':' + this.password ).toString( 'base64' )
            } : void 0
        } );

        // this.clientLifetime = new Lifetime();
        // const client = new WebSocket( `ws://${ this.address }:${ this.port }` );
        // this.clientLifetime = new Lifetime();

        // const openLifetime = this.clientLifetime.bind( new Lifetime() );

        // await new Promise( ( resolve, reject ) => {
        //     openLifetime.bindEvent( client, 'open', resolve );
        //     openLifetime.bindEvent( client, 'error', reject );

        // } );
        
        // this.client = client;
        
        // this.clientLifetime.bindEvent( client, 'close', () => this.close() );
    }

    close () {
        if ( this.client != null && this.clientLifetime != null ) {
            this.clientLifetime.close();
        }
        
        this.clientLifetime = null;

        this.client = null;
    }

    async call <R = void>( command : string, args : any = {} ) : Promise<R> {
        if ( !this.connected ) {
            await this.open();
        }

        try {
            return await this.request<R>( command, args );
        } catch ( err ) {
            if ( err && err.message && err.message.includes( 'socket not ready' ) ) {
                this.close();
                
                return this.call( command, args );
            }

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

    play ( record : PlayableMediaRecord, options : any = {} ) : Promise<void> {
        return this.call( 'Player.Open', { item: { file: `plugin://plugin.video.unicast/play/${ record.kind }/${ record.id }` } } );
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

    subtitleScale ( scale : number ) : Promise<void> {
        return this.call( 'subtitleScale', scale );
    }

    setMultipleProperties ( properties : any ) : Promise<void> {
        return this.call( 'setMultipleProperties', properties );
    }

    showProgress () {
        return this.call( 'Input.ShowOSD' );
    }

    quit () : Promise<void> {
        return this.call( 'System.Shutdown' );
    }
}