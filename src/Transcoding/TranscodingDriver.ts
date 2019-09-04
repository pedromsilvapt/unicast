import { BackgroundTask } from "../BackgroundTask";
import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { DriverFactory } from "./DriverFactory";
import { MediaRecord } from '../MediaRecord';

export interface TranscodingDriver {
    readonly factory : DriverFactory<this>;
}

export class TranscodingBackgroundTask extends BackgroundTask {
    cancelable : boolean = true;
    
    record : MediaRecord;

    public constructor ( record : MediaRecord ) {
        super();

        this.record = record;
    }

    getMetadata () {
        return {
            type: 'transcoding',
            media: this.record
        };
    }
}