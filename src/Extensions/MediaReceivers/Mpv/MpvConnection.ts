import { Client as WebSocket } from 'rpc-websockets';
import { Synchronized } from 'data-semaphore';
import { Lifetime } from '../../../ES2017/Lifetime';
import { LoadOptions, LoadFlags } from 'unicast-mpv/lib/Player';

export class MpvConnection {
    public readonly address : string;

    public readonly port : number;

    protected client : any = null;

    protected clientLifetime : Lifetime = null;

    constructor ( address : string, port : number ) {
        this.address = address;
        this.port = port;
    }

    public get connected () {
        return this.client != null;
    }

    @Synchronized()
    async open () {
        if ( this.client != null ) {
            return;
        }

        const client = new WebSocket( `ws://${ this.address }:${ this.port }` );
        this.clientLifetime = new Lifetime();

        const openLifetime = this.clientLifetime.bind( new Lifetime() );

        await new Promise( ( resolve, reject ) => {
            openLifetime.bindEvent( client, 'open', resolve );
            openLifetime.bindEvent( client, 'error', reject );
        } );
        
        this.client = client;
        
        this.clientLifetime.bindEvent( client, 'close', () => this.close() );
    }

    close () {
        if ( this.client != null ) {
            this.client.close();

            if ( this.clientLifetime != null ) {
                this.clientLifetime.close();
            }
        }
        
        this.clientLifetime = null;

        this.client = null;
    }

    async call <R = void>( command : string, ...args : any[] ) : Promise<R> {
        if ( !this.connected ) {
            await this.open();
        }

        try {
            return await this.client.call( command, args );
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

    async play ( file : string, subtitles : string, options : LoadOptions ) : Promise<void> {
        return this.call( 'play', file, subtitles, options );
    }

    async loadFile ( file : string, flags : LoadFlags = LoadFlags.Replace, options : LoadOptions = {} ) : Promise<void> {
        return this.call( 'loadFile', file, flags, options );
    }

    pause () : Promise<void> {
        return this.call( 'pause' );
    }

    resume () : Promise<void> {
        return this.call( 'resume' );
    }

    stop () : Promise<void> {
        return this.call( 'stop' );
    }

    status () : Promise<any> {
        return this.call( 'status' );
    }

    seek ( time : number ) : Promise<void> {
        return this.call( 'seek', time );
    }

    goToPosition ( time : number ) : Promise<void> {
        return this.call( 'goToPosition', time );
    }

    mute () : Promise<void> {
        return this.call( 'mute', true );
    }

    unmute () : Promise<void> {
        return this.call( 'mute', false );
    }

    volume ( level : number ) : Promise<void> {
        return this.call( 'volume', level );
    }

    adjustSubtitleTiming ( seconds : number ) : Promise<void> {
        return this.call( 'adjustSubtitleTiming', seconds );
    }

    subtitleScale ( scale : number ) : Promise<void> {
        return this.call( 'subtitleScale', scale );
    }

    setMultipleProperties ( properties : any ) : Promise<void> {
        return this.call( 'setMultipleProperties', properties );
    }

    showProgress () {
        return this.call( 'showProgress' );
    }

    quit () : Promise<void> {
        return this.call( 'quit' );
    }
}