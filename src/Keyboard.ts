import * as keypress from 'keypress';
import * as parseKey from 'parse-key';

export interface Key {
    ctrl: boolean;
    meta : boolean;
    shift : boolean;
    name : string;
}

export class Keyboard {
    static listeners : (( key : Key ) => void)[] = [];

    static isSetup : boolean = false;    

    static close () {
        process.stdin.removeAllListeners( 'keypress' );

        if ( ( process.stdin as any ).setRawMode ) {
            ( process.stdin as any ).setRawMode( false );
            
            process.stdin.pause();
        }
    }

    static setup ( shutdown ?: () => void ) {
        if ( this.isSetup ) {
            return;
        }

        // make `process.stdin` begin emitting "keypress" events
        keypress( process.stdin );

        // listen for the "keypress" event
        process.stdin.on( 'keypress', ( ch : string, key : Key ) => {
            if ( key ) {
                if ( key.name == 'c' && key.ctrl && !key.shift && !key.meta ) {
                    if ( shutdown ) {
                        shutdown();
                    } else {
                        process.exit( 0 );
                    }
                }

                for ( let listener of this.listeners ) {
                    listener( key );
                }
            }
        } );

        if ( ( process.stdin as any ).setRawMode ) {
            ( process.stdin as any ).setRawMode( true );
            
            process.stdin.resume();
        }

        this.isSetup = true;
    }

    static addListener ( listener : ( key : Key ) => void ) {
        this.setup();

        this.listeners.push( listener );
    }

    static removeListener ( listener : ( key : Key ) => void ) {
        const index = this.listeners.indexOf( listener );

        if ( index >= 0 ) {
            this.listeners.splice( index, 1 );
        }
    }

    static match ( k1 : Key, k2 : Key ) {
        return k1.name == k2.name && k1.ctrl == k2.ctrl && k1.meta == k2.meta && k1.shift == k2.shift;
    }

    keys : [Key, (( key : Key ) => void)][] = [];

    constructor ( standalone : boolean = true ) {
        if ( standalone ) {
            Keyboard.setup();
        }

        Keyboard.addListener( this.doKeyPress.bind( this ) );
    }

    doKeyPress ( key : Key ) {
        for ( let [ registeredKey, callback ] of this.keys ) {
            if ( Keyboard.match( key, registeredKey ) ) {
                callback( key );
            }
        }
    }

    on ( key : string | Key, cb : ( key : Key ) => void ) : this {
        if ( typeof key === 'string' ) {
            key = parseKey( key ) as Key;
        }

        this.keys.push( [ key, cb ] );

        return this;
    }
}