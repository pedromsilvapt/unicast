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

export interface TranscodedMediaStream {
    isTranscoded : true;

    task : BackgroundTask;
}

export function isTranscodedMediaStream<T> ( stream : T ) : stream is T & TranscodedMediaStream {
    return stream && ( stream as any ).isTranscoded;
}