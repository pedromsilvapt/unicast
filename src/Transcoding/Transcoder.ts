import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { HistoryRecord } from "../Database/Database";
import { MediaRecord } from "../MediaRecord";
import { CancelToken } from 'data-cancel-token';
import { TranscodingBackgroundTask } from "./TranscodingDriver";

export class TranscodingSession<O = any> {
    task : TranscodingBackgroundTask;

    options : Partial<O>;
    
    streams : MediaStream[]

    constructor ( task : TranscodingBackgroundTask, options : Partial<O>, streams : MediaStream[] ) {
        this.task = task;
        this.options = options;
        this.streams = streams;
    }
}

export abstract class Transcoder<O> {
    abstract transcode ( session : HistoryRecord, media : MediaRecord, streams : MediaStream[], options ?: Partial<O>, cancel ?: CancelToken ) : Promise<MediaStream[]>;
}