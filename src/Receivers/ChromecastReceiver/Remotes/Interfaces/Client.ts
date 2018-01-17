import { Player, co } from './Player';

import * as util from 'util';

export class Client {
    public native : any;

    constructor ( native : any ) {
        this.native = native;

        this.getStatus = util.promisify( native.getStatus.bind( native ) );
        this.getSessions = util.promisify( native.getSessions.bind( native ) );
        this.connect = util.promisify( native.connect.bind( native ) );
        this.close = native.close.bind( native );
        this.join = co( util.promisify( native.join.bind( native ) ), p => new Player( p ) );
        this.launch = co( util.promisify( native.launch.bind( native ) ), p => new Player( p ) );
        this.stop = co( p => p.native, util.promisify( native.stop.bind( native ) ) );
        this.setVolume = util.promisify( native.setVolume.bind( native ) );
        this.getVolume = util.promisify( native.getVolume.bind( native ) );
    }

    public getStatus : () => Promise<any>;

    public getSessions : () => Promise<any[]>;

    public connect : ( address : string ) => Promise<void>;

    public close : () => void;
    
    public join : ( session : any, app : any ) => Promise<Player>;

    public launch : ( app : any ) => Promise<Player>;

    public stop : ( Player : Player ) => Promise<void>;

    public setVolume : ( volume : { level?: number, muted ?: boolean } ) => Promise<void>;

    public getVolume : () => Promise<{ level : number, muted : boolean }>;
}