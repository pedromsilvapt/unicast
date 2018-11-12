import { EventEmitter }     from 'events';
import { Client as NativeClient }           from 'castv2-client';
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

            this.client.native.on( 'error', error => {
                this.emit( 'error', error );
            } ).on( 'status', status => {
                if ( status && status.applications instanceof Array ) {
                    this.verify( status.applications.find( app => app.appId === this.application.APP_ID ) );
                }
    
                this.emit( 'app-status', status );
            } ).on( 'close', status => {
                if ( this.shouldBeConnected ) {
                    this.reconnect();
                }
            } );
        }

        await this.client.connect( this.address );

        this.emit( 'connected' );

        this.isConnected = true;

        this.shouldBeConnected = true;

        this.player = null;

        this.isOpened = false;

        this.currentSessionId = null;
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

    protected onPlayerError ( error ) {
        this.emit( 'error', error );
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

        this.emit( 'player-joined', this.player );

        this.currentSessionId = this.player.native.session.sessionId;

        this.player.native.on( 'error', this.onPlayerError.bind( this ) );

        this.player.native.on( 'close', this.onPlayerClose.bind( this ) );
    }

    @Singleton( () => 'launch' )
    async launch () {
        if ( !this.isConnected ) {
            await this.connect();
        }

        this.isLaunching = true;
        
        this.player = await this.client.launch( this.application );

        this.emit( 'player-launched', this.player );

        this.isOpened = true;

        this.currentSessionId = this.player.native.session.sessionId;
        
        this.isLaunching = false;

        this.player.native.on( 'error', this.onPlayerError.bind( this ) );

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


    async disconnect () {
        return this.close( false );
    }

    async close ( effective : boolean = true ) {
        if ( this.isOpened ) {
            this.emit( 'closing' );

            if ( effective ) {
                await this.client.stop( this.player ).catch( err => this.onPlayerError( err ) );
            }
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

            try {
                this.client.close();
            } catch ( err ) {
                this.onPlayerError( err );
            }
        }

        this.client = null;

        this.shouldBeOpened = false;

        if ( this.isConnected ) {
            this.isConnected = false;

            this.emit( 'disconnected' );
        }
    }
}
