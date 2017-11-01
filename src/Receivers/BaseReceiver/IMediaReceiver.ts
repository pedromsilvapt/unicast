import { MediaRecord, MediaKind } from "../../MediaRecord";
import { UnicastServer } from "../../UnicastServer";
import { MediaSessionsManager } from "./MediaSessionsManager";
import { Transcoder } from "../../Transcoding/Transcoder";

export enum ReceiverStatusState {
    Stopped = 'STOPPED',
    Playing = 'PLAYING',
    Paused = 'PAUSED',
    Buffering = 'BUFFERING'
}

export interface ReceiverStatus {
    session : string;
    timestamp : Date;
    state : ReceiverStatusState;
    media : {
        time : ReceiverTimeStatus;
        record : MediaRecord;
    }
    volume : ReceiverVolumeStatus;
    subtitlesStyle : ReceiverSubtitlesStyleStatus;
}

export interface ReceiverTimeStatus {
    current : number;
    duration : number;
}

export interface ReceiverVolumeStatus {
    level : number;
    muted : boolean;
}

export interface ReceiverSubtitlesStyleStatus {
    size : number;
}

export interface MediaPlayOptions {
    autostart ?: boolean;
    startTime ?: number;
    playlistId ?: string;
    playlistPosition ?: number;
    mediaKind ?: string;
    mediaId ?: string;
}

export interface IMediaReceiver {
    readonly connected : boolean;

    readonly name : string;

    readonly type : string;

    readonly server : UnicastServer;

    readonly sessions : MediaSessionsManager;

    readonly transcoder : Transcoder<any>;

    connect () : Promise<boolean>;

    disconnect () : Promise<boolean>;

    reconnect () : Promise<boolean>;


    play ( session : string ) : Promise<ReceiverStatus>;

    pause () : Promise<ReceiverStatus>;

    resume () : Promise<ReceiverStatus>;

    stop () : Promise<ReceiverStatus>;

    status () : Promise<ReceiverStatus>;

    seek ( time : number ) : Promise<ReceiverStatus>;

    seekTo ( time : number ) : Promise<ReceiverStatus>;

    callCommand<R = ReceiverStatus, A = any[]> ( commandName : string, args : A ) : Promise<R>;

    toJSON () : any;
}