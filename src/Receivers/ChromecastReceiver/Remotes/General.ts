import { EventEmitter }     from 'events';
import * as objectPath      from 'object-path';
import { Client }           from 'castv2-client';
import * as promisify       from 'es6-promisify';

export interface ChromecastPlayOptions {
    autoplay ?: boolean;
    currentTime ?: number;
    activeTrackIds ?: number[];
}

export class GeneralRemote extends EventEmitter {
    connected : boolean = false;

    connection = null;

    appId : string = null;

    application = null;

    address : string;

    player : any;

    client : any;

    playerAsync : any;

    clientAsync : any;

    get name () {
        throw new Error( `Name retrieval is not implemented yet.` );
    }

    constructor ( address : string ) {
        super();

        this.address = address;

        this.eraseConnection();
    }

    eraseConnection () {
        this.connected = false;
        this.connection = null;

        this.client = null;
        this.player = null;
        this.playerAsync = {};
        this.clientAsync = {};
    }

    setConnection ( client : any, player : any ) {
        this.client = client;
        this.player = player;

        this.client.on( 'status', status => {
            let connectedStill = status && status.applications instanceof Array && status.applications.some( app => app.appId === this.application.APP_ID );

            if ( !connectedStill ) {
                this.eraseConnection();
            }

            this.emit( 'app-status', status );
        } );
    }

    async callPlayerMethod ( name : string, args : any[] = [], events : string | string[] = [] ) {
        await this.ensureConnection();

        return this.callAsyncMethod( this.player, this.playerAsync, name, args, events );
    }

    async callClientMethod ( name : string, args : any[] = [], events : string | string[] = [] ) {
        await this.ensureConnection();

        return this.callAsyncMethod( this.client, this.clientAsync, name, args, events );
    }

    async callAsyncMethod ( original : any, async : any, name : string, args : any[] = [], events : string | string[] = [] ) {
        if ( typeof events === 'string' ) {
            events = [ null, events ];
        }

        if ( !( name in async ) ) {
            let parent = name.split( '.' ).length > 1 ? objectPath.get( original, name.split( '.' ).slice( 0, -1 ).join( '.' ) ) : original;
            
            async[ name ] = promisify( ( objectPath as any ).withInheritedProps.get<any, Function>( original, name ).bind( parent ) );
        }

        if ( events[ 0 ] ) {
            this.emit( events[ 0 ] );
        }

        let result = async[ name ]( ...args );

        if ( events[ 1 ] ) {
            this.emit( events[ 1 ], result );
        }

        return result;
    }

    async ensureConnection () {
        if ( this.connected ) {
            return this.connection;
        }

        return this.reconnect();
    }

    reconnect () {
        this.connected = true;

        this.connection = new Promise( ( resolve, reject ) => {
            try {
                if ( this.client ) {
                    this.client.close();
                }

                let client = new Client();
                client.connect( this.address, () => {
                    client.launch( this.application, ( error, player ) => {
                        if ( error ) {
                            this.emit( 'error', error );

                            client.close();

                            return reject( error );
                        }

                        this.setConnection( client, player );

                        this.emit( 'connected' );

                        resolve( [ client, player ] );
                    } );
                } );

                client.on( 'error', err => {
                    this.emit( 'error', err );

                    client.close();

                    reject( err );
                } );

                client.on( 'close', () => {
                    if ( this.connected ) {
                        console.log( 'DEBUG', 'Reconnecting...' )
                        this.reconnect();
                    }
                } );
            } catch ( err ) {
                reject( err );
            }
        } );

        return this.connection;
    }

    getStatus () {
        return Promise.race( [
            this.callPlayerMethod( 'getStatus', [], 'status' ).catch( () => null ),
            new Promise( ( _, reject ) => setTimeout( reject.bind( null, new Error( 'Chromecast getStatus timeout.' ) ), 5000 ) )
        ] );
    }

    close () {
        if ( this.connected ) {
            this.emit( 'disconnecting' );

            // We mark the connected state as falso so any code listening to the close event knows that it is a forced connection
            // This way, if the connection drops unnexpectadly, we can check this variable to see if it is purposful or if needs a reconnection
            this.connected = false;

            this.player.close();

            this.client.close();

            this.eraseConnection();

            this.emit( 'disconnected' );
        }
    }
}