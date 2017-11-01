import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { HistoryRecord } from "../Database";
import { MediaRecord } from "../MediaRecord";
import { CancelToken } from "../ES2017/CancelToken";

export abstract class Transcoder<O> {
    abstract transcode ( session : HistoryRecord, media : MediaRecord, streams : MediaStream[], options ?: Partial<O>, cancel ?: CancelToken ) : Promise<MediaStream[]>;
}