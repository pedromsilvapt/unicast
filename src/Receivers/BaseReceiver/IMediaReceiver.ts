import { MediaRecord, MediaKind } from "../../MediaRecord";
import { UnicastServer } from "../../UnicastServer";
import { MediaSessionsManager } from "./MediaSessionsManager";
import { Transcoder } from "../../Transcoding/Transcoder";
import { EventEmitter } from "events";
import { HistoryRecord } from "../../Database/Database";

export enum ReceiverStatusState {
    Stopped = 'STOPPED',
    Playing = 'PLAYING',
    Paused = 'PAUSED',
    Buffering = 'BUFFERING'
}

export interface ReceiverStatus {
    timestamp : Date;
    state : ReceiverStatusState;
    media : {
        time : ReceiverTimeStatus;
        record : MediaRecord;
        session: HistoryRecord;
        options: any;
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
    subtitlesOffset ?: number;
}

export interface IMediaReceiver extends EventEmitter {
    readonly connected : boolean;

    readonly name : string;

    readonly type : string;

    readonly server : UnicastServer;

    readonly sessions : MediaSessionsManager;

    readonly transcoder : Transcoder<any>;

    connect () : Promise<boolean>;

    disconnect () : Promise<boolean>;

    reconnect () : Promise<boolean>;

    turnoff () : Promise<ReceiverStatus>;

    play ( session : string ) : Promise<ReceiverStatus>;

    pause () : Promise<ReceiverStatus>;

    resume () : Promise<ReceiverStatus>;

    stop () : Promise<ReceiverStatus>;

    status () : Promise<ReceiverStatus>;

    seek ( time : number ) : Promise<ReceiverStatus>;

    seekTo ( time : number ) : Promise<ReceiverStatus>;

    mute () : Promise<ReceiverStatus>;

    unmute () : Promise<ReceiverStatus>;

    setVolume ( volume : number ) : Promise<ReceiverStatus>;

    callCommand<R = ReceiverStatus, A extends any[] = any[]> ( commandName : string, args : A ) : Promise<R>;

    toJSON () : any;
}