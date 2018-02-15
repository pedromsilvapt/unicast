import { EventEmitter }     from 'events';
import * as objectPath      from 'object-path';
import { Client as NativeClient, DefaultMediaReceiver }           from 'castv2-client';
import * as util           from 'util';
import * as promisify       from 'es6-promisify';
import { Client } from './Interfaces/Client';
import { Player } from './Interfaces/Player';
import { Singleton } from '../../../ES2017/Singleton';

export interface ChromecastPlayOptions {
    autoplay ?: boolean;
    currentTime ?: number;
    activeTrackIds ?: number[];
}

export class GeneralRemote extends EventEmitter {
    appId : string = null;

    application = null;

    address : string;

    player : Player;

    client : Client;

    isConnected : boolean = false;

    shouldBeConnected : boolean = false;

    currentSessionId : string = null;

    isLaunching : boolean = true;

    isOpened : boolean = false;

    shouldBeOpened : boolean = false;

    get name () {
        throw new Error( `Name retrieval is not implemented yet.` );
    }

    constructor ( address : string ) {
        super();

        this.address = address;
    }

    @Singleton( () => 'connect' )
    async connect () {
        if ( !this.client ) {
            this.client = new Client( new NativeClient( this.address ) );
        }

        await this.client.connect( this.address );

        this.isConnected = true;

        this.shouldBeConnected = true;

        this.player = null;

        this.isOpened = false;

        this.currentSessionId = null;
        
        this.client.native.on( 'status', status => {
            if ( status && status.applications instanceof Array ) {
                this.verify( status.applications.find( app => app.appId === this.application.APP_ID ) );
            }

            this.emit( 'app-status', status );
        } ).on( 'close', status => {
            if ( this.shouldBeConnected ) {
                this.reconnect();
            }
        } ).on( 'error', error => {
            console.error( 'error', error.message, error.stack );
        } );
    }

    protected async verify ( session : any ) {
        if ( this.isLaunching ) {
            return;
        }

        if ( this.isOpened ) {
            if ( !session || session.sessionId != this.currentSessionId ) {
                this.currentSessionId = null;

                this.isOpened = false;

                this.player.close();

                this.player = null;
            } else {
                return;
            }
        }

        if ( session ) {
            await this.join( session );
        } else if ( this.shouldBeOpened ) {
            await this.launch();
        }
    }

    protected onPlayerClose () {
        this.player = null;

        this.isOpened = false;

        this.shouldBeOpened = false;
    }

    @Singleton( () => 'join' )
    async join ( app : any ) {
        if ( !this.isConnected ) {
            await this.connect();
        }

        this.isOpened = true;

        this.player = await this.client.join( app, this.application );

        this.currentSessionId = this.player.native.session.sessionId;

        this.player.native.on( 'close', this.onPlayerClose.bind( this ) );
    }

    @Singleton( () => 'launch' )
    async launch () {
        if ( !this.isConnected ) {
            await this.connect();
        }

        this.isLaunching = true;
        
        this.player = await this.client.launch( this.application );

        this.isOpened = true;

        this.currentSessionId = this.player.native.session.sessionId;
        
        this.isLaunching = false;

        this.player.native.on( 'close', this.onPlayerClose.bind( this ) );
    }

    async open () {
        if ( !this.isConnected ) {
            await this.connect();
        }
        
        this.shouldBeOpened = true;

        const sessions = await this.client.getSessions();

        let match = sessions.find( app => app.appId === this.application.APP_ID );

        if ( match ) {
            await this.join( match );
        } else {
            await this.launch();
        }
    }

    async reconnect () {
        if ( this.shouldBeOpened ) {
            this.close();
    
            await this.open();
        } else {
            this.close();
    
            await this.connect();
        }
    }

    async getStatus () {
        if ( !this.isConnected ) {
            await this.connect();
        }

        if ( !this.isOpened ) {
            return null;
        }

        return Promise.race( [
            this.player.getStatus().catch( err => { console.error( err ); return null; } ),
            new Promise( ( _, reject ) => setTimeout( reject.bind( null, new Error( 'Chromecast getStatus timeout.' ) ), 5000 ) )
        ] );
    }

    close ( efective : boolean = true ) {
        if ( this.isOpened ) {
            this.emit( 'closing' );

            this.client.stop( this.player );
        }

        this.player = null;

        this.shouldBeConnected = false;

        if ( this.isOpened ) {
            this.isOpened = false;

            this.emit( 'closed' );
        }

        if ( this.isConnected ) {
            this.emit( 'disconnecting' );

            // We mark the connected state as false so any code listening to the close event knows that it is a forced connection
            // This way, if the connection drops unnexpectedly, we can check this variable to see if it is purposeful or if needs a reconnection
            this.isConnected = false;

            this.client.close();
        }

        this.client = null;

        this.shouldBeOpened = false;

        if ( this.isConnected ) {
            this.isConnected = false;

            this.emit( 'disconnected' );
        }
    }
}
