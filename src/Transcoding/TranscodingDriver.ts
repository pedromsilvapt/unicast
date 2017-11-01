import { BackgroundTask } from "../BackgroundTask";
import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { DriverFactory } from "./DriverFactory";

export interface TranscodingDriver {
    readonly factory : DriverFactory<this>;
}

export class TranscodingBackgroundTask extends BackgroundTask {
    cancelable : boolean = true;

    stream : MediaStream;
}