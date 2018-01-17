import * as util from 'util';

export function co<A, B, C> ( a : ( a : A ) => B | Promise<B>, b : ( b : B ) => C | Promise<C> ) : ( i : A, ...args : any[] ) => Promise<C> {
    return async ( i, ...args ) => b( await a( i, ...args ), ...args );
}

export class Player {
    public native : any;

    constructor ( native : any ) {
        this.native = native;
        this.getStatus = util.promisify( native.getStatus.bind( native ) );
        this.load = util.promisify( native.load.bind( native ) );
        this.play = util.promisify( native.play.bind( native ) );
        this.pause = util.promisify( native.pause.bind( native ) );
        this.stop = util.promisify( native.stop.bind( native ) );
        this.seek = util.promisify( native.seek.bind( native ) );
        this.queueLoad = util.promisify( native.queueLoad.bind( native ) );
        this.queueInsert = util.promisify( native.queueInsert.bind( native ) );
        this.queueRemove = util.promisify( native.queueRemove.bind( native ) );
        this.queueReorder = util.promisify( native.queueReorder.bind( native ) );
        this.queueUpdate = util.promisify( native.queueUpdate.bind( native ) );

        this.disableSubtitles = co( () => ( {
            type: 'EDIT_TRACKS_INFO',
            activeTrackIds: []
        } ), util.promisify( native.media.sessionRequest.bind( native.native ) ) ) as any;

        this.setActiveSubtitles = co( index => ( {
            type: 'EDIT_TRACKS_INFO',
            activeTrackIds: [ index ]
        } ), util.promisify( native.media.sessionRequest.bind( native.native ) ) );

        this.setSubtitlesStyle = co( style => ( {
            type: 'EDIT_TRACKS_INFO',
            textTrackStyle: style
        } ), util.promisify( native.media.sessionRequest.bind( native.native ) ) );
    }

    public getStatus : () => Promise<any>;

    public load : ( media : any, options ?: any ) => Promise<any>;

    public play : () => Promise<any>;

    public pause : () => Promise<any>;

    public stop : () => Promise<any>;

    public seek  : ( time : number ) => Promise<any>;

    public queueLoad : ( items : any[], options : any ) => Promise<any>;
    
    public queueInsert : ( items : any[], options : any ) => Promise<any>;
    
    public queueRemove : ( items : any[], options : any ) => Promise<any>;
    
    public queueReorder : ( items : any[], options : any ) => Promise<any>;

    public queueUpdate : ( items : any[] ) => Promise<any>;

    public disableSubtitles : () => Promise<void>;

    public setActiveSubtitles : ( index : number ) => Promise<void>;

    public setSubtitlesStyle : ( style : any ) => Promise<void>;

    public close : () => void;
}