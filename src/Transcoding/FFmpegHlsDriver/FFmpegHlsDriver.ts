import { TranscodingDriver, TranscodingBackgroundTask } from "../TranscodingDriver";
import { DriverFactory } from "../DriverFactory";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegDriver } from "../FFmpegDriver/FFmpegDriver";
import { UnicastServer } from "../../UnicastServer";
import { FFmpegTranscodingTask } from "../FFmpegDriver/FFmpegTranscodingTask";
import { spawn } from 'child_process';
import { FFmpegHlsTranscodingTask } from "./FFmpegHlsTranscodingTask";

export class FFmpegHlsDriverFactory extends DriverFactory<FFmpegHlsDriver> {
    constructor () {
        super( 'video', 'ffmpeg-hls' );
    }

    create ( server : UnicastServer ) : FFmpegHlsDriver {
        const driver = new FFmpegHlsDriver( server );

        driver.factory = this;
        
        return driver;
    }
}

export class FFmpegHlsDriver extends FFmpegDriver {
    protected segmentStartNumber : number = null;

    protected segmentDuration : number = null;

    protected segmentLocationPrefix : string = null;

    protected segmentListSize : number = null;

    protected hlsPlaylistType : FFmpegHlsPlaylistType = FFmpegHlsPlaylistType.VideoOnDemand;

    protected hlsFlags : Set<FFmpegHlsFlag> = new Set();

    protected forceKeyFrames : boolean = false;

    protected copyTimestamps : boolean = false;

    constructor ( server : UnicastServer ) {
        super( server );

        this.setFormat( 'hls' );
    }

    setSegmentStartNumber ( segment : number ) : this {
        this.segmentStartNumber = segment;

        return this;
    }
    
    setSegmentDuration ( duration : number ) : this {
        this.segmentDuration = duration;

        return this;
    }

    getSegmentDuration () : number {
        return this.segmentDuration;
    }

    setSegmentLocationPrefix ( prefix : string ) : this {
        this.segmentLocationPrefix = prefix;
        
        return this;
    }
    
    getSegmentLocationPrefix () : string {
        return this.segmentLocationPrefix;
    }

    setSegmentListSize ( size : number ) : this {
        this.segmentListSize = size;
        
        return this;
    }

    setHlsFlags ( flags : FFmpegHlsFlag[] ) : this {
        this.hlsFlags = new Set( flags );

        return this;
    }
    
    addHlsFlags ( flags : FFmpegHlsFlag[] ) : this {
        for ( let flag of flags ) {
            this.hlsFlags.add( flag );
        }

        return this;
    }

    removeHlsFlags ( flags : FFmpegHlsFlag[] ) : this {
        for ( let flag of flags ) {
            this.hlsFlags.delete( flag );
        }

        return this;
    }

    getHlsFlags () : FFmpegHlsFlag[] {
        return Array.from( this.hlsFlags );
    }

    setHlsPlaylistType ( type : FFmpegHlsPlaylistType ) : this {
        this.hlsPlaylistType = type;
        
        return this;
    }

    setCopyTimestamps ( copy : boolean = true ) : this {
        this.copyTimestamps = copy;

        return this;
    }

    setForceKeyFrames ( force : boolean = true ) : this {
        this.forceKeyFrames = force;
        
        return this;
    }

    getCompiledArguments ( stream : MediaStream ) : string[] {
        if ( this.copyTimestamps && typeof this.startTime === 'number' ) {
            this.outputDuration += this.startTime;
        }

        const args : string[] = super.getCompiledArguments( stream );

        if ( this.copyTimestamps && typeof this.startTime === 'number' ) {
            this.outputDuration -= this.startTime;
        }

        if ( this.segmentStartNumber !== null ) {
            args.push( '-start_number', '' + this.segmentStartNumber )
        } else {
            args.push( '-start_number', '0' )
        }

        if ( this.segmentDuration !== null ) {
            args.push( '-hls_time', '' + this.segmentDuration )
        }

        if ( this.segmentLocationPrefix !== null ) {
            args.push( '-hls_base_url', '' + this.segmentLocationPrefix )
        }

        if ( this.segmentListSize !== null ) {
            args.push( '-hls_list_size', '' + this.segmentListSize );
        }

        if ( this.hlsFlags.size ) {
            args.push( '-hls_flags', this.getHlsFlags().join( '+' ) );
        }

        if ( this.hlsPlaylistType ) {
            args.push( '-hls_playlist_type', this.hlsPlaylistType );
        }

        if ( this.copyTimestamps ) {
            if ( typeof this.startTime === 'number' ) {
                args.push( '-output_ts_offset', '' + this.startTime );
            }
        }

        if ( this.forceKeyFrames ) {
            args.push( '-force_key_frames', `expr:gte(t,n_forced*${ this.segmentDuration })` );
        }

        // args.push( '-ar', '44100' );
        // args.push( '-x264opts', 'keyint=48:min-keyint=48:no-scenecut' );
        //args.push( '-ac', '2', '-af', 'pan=stereo|FL=FC+0.30*FL+0.30*BL|FR=FC+0.30*FR+0.30*BR' );
        args.push( '-ac', '2' );
        
        return args;
    }

    import ( driver : FFmpegHlsDriver ) : this {
        super.import( driver );

        this.startTime = driver.startTime;
        this.outputDuration = driver.outputDuration;
        this.segmentStartNumber = driver.segmentStartNumber;
        this.segmentDuration = driver.segmentDuration;
        this.segmentLocationPrefix = driver.segmentLocationPrefix;
        this.hlsFlags = new Set( driver.hlsFlags || [] );
        this.segmentListSize = driver.segmentListSize;
        this.hlsPlaylistType = driver.hlsPlaylistType;
        this.forceKeyFrames = driver.forceKeyFrames;
        this.copyTimestamps = driver.copyTimestamps;

        return this;
    }
}

export enum FFmpegHlsFlag {
    SingleFile = 'single_file',
    DeleteSegments = 'delete_segments',
    AppendList = 'append_list',
    RoundDurations = 'round_durations',
    DiscontStart = 'discont_start',
    OmitEndList = 'omit_endlist',
    PeriodicRekey = 'periodic_rekey',
    SplitByTime = 'split_by_time',
    ProgramDateTime = 'program_date_time',
    SecondLevelSegmentIndex = 'second_level_segment_index',
    SecondLevelSegmentSize = 'second_level_segment_size',
    SecondLevelSegmentDuration = 'second_level_segment_duration',
    TempFile = 'temp_file'
}

export enum FFmpegHlsPlaylistType {
    VideoOnDemand = 'vod',
    Event = 'event',
    Live = 'live'
}

// export function mute ( input : Stream, start : number, end : number, duration : number ) {
//     const preMute = atrim( input, 0, start );

//     const posMute = atrim( input, end, duration );

//     const muted = silence( end - start );

//     const [ output ] = concat( [], [ preMute, muted, posMute ] );

//     return output;
// }