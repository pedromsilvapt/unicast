import { IMediaReceiver, MediaPlayOptions, ReceiverStatus } from './IMediaReceiver'
import { EventEmitter } from "events";
import { UnicastServer } from "../../UnicastServer";
import { MediaSessionsManager } from "./MediaSessionsManager";
import { Transcoder } from '../../Transcoding/Transcoder';

export abstract class BaseReceiver extends EventEmitter implements IMediaReceiver {
    abstract readonly connected: boolean;

    readonly name : string;

    abstract readonly type : string;

    readonly server : UnicastServer;

    readonly sessions : MediaSessionsManager;

    transcoder : Transcoder<any>;

    constructor ( server : UnicastServer, name : string ) {
        super();
        
        this.server = server;
        this.name = name;
        this.sessions = new MediaSessionsManager( this, server.media );
    }

    onEntityDestroy () {
        this.sessions.destroy();
    }

    abstract connect () : Promise<boolean>;
    
    abstract disconnect () : Promise<boolean>;
    
    abstract reconnect () : Promise<boolean>;

    abstract turnoff () : Promise<ReceiverStatus>;
    
    abstract play ( session : string, options ?: Partial<MediaPlayOptions> ) : Promise<ReceiverStatus>;

    abstract pause () : Promise<ReceiverStatus>;

    abstract resume () : Promise<ReceiverStatus>;
    
    abstract stop () : Promise<ReceiverStatus>;

    abstract status () : Promise<ReceiverStatus>;

    abstract seek ( time : number ) : Promise<ReceiverStatus>;

    abstract seekTo ( time : number ) : Promise<ReceiverStatus>;

    abstract mute () : Promise<ReceiverStatus>;

    abstract unmute () : Promise<ReceiverStatus>;

    abstract setVolume ( level : number ) : Promise<ReceiverStatus>;

    abstract callCommand<R = any, A extends any[] = any[]> ( commandName : string, args : A ) : Promise<R>;

    abstract toJSON();
}


export class ReceiverSubtitlesStyles<T = any> {
    defaultStyles : any;

    customGlobalProperties : any = {};

    customStyles : T[];

    customStyleIndex : number;
    
    currentStyle : any;

    constructor ( defaultStyles : any, customStyles : T[] = [], customGlobalProperties : any = {} ) {
        this.defaultStyles = defaultStyles;

        this.customStyles = customStyles;

        this.customGlobalProperties = customGlobalProperties || {};

        this.customStyleIndex = 0;

        this.cacheCurrentStyle();
    }

    public setCustomGlobalProperty ( property : string, value : any ) {
        const lastValue = this.getCustomGlobalProperty( property );

        if ( lastValue != value ) {
            this.customGlobalProperties[ property ] = value;

            this.cacheCurrentStyle();
        }
    }

    public getCustomGlobalProperty<T = any> ( property : string, defaultValue : T = void 0 ) : T {
        if ( property in this.customGlobalProperties ) {
            return this.customGlobalProperties[ property ];
        }

        return defaultValue;
    }

    public setCustomStyleIndex ( index : number ) : this {
        if ( index != this.customStyleIndex ) {
            this.customStyleIndex = index;

            this.cacheCurrentStyle();
        }

        return this;
    }

    public cycleCustomStyles () : this {
        if ( this.customStyles.length > 0 ) {
            this.setCustomStyleIndex( ( this.customStyleIndex + 1 ) % this.customStyles.length );
        }

        return this;
    }

    protected cacheCurrentStyle () {
        let temp = { ...this.defaultStyles, ...this.customGlobalProperties };

        if ( this.customStyles.length > this.customStyleIndex ) {
            temp = { ...temp, ...this.customStyles[ this.customStyleIndex ] };
        }

        this.currentStyle = temp;
    }
}