import { TranscodingBackgroundTask } from "../TranscodingDriver";
import * as progressStream from 'ffmpeg-progress-stream';
import { ChildProcess } from "child_process";

export class FFmpegTranscodingTask extends TranscodingBackgroundTask {
    child : ChildProcess;
    
    constructor ( args : string, destination : string ) {
        super();

        this.child = child;

        this.child.stderr.pipe( progressStream( Infinity ) ).on( 'data', status => {
            this.addDone( status.frame - this.done );
        } );
    }
}