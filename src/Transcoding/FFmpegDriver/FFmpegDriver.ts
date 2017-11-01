import { TranscodingDriver, TranscodingBackgroundTask } from "../TranscodingDriver";
import { DriverFactory } from "../DriverFactory";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { UnicastServer } from "../../UnicastServer";
import { spawn } from 'child_process';
import { FFmpegTranscodingTask } from "./FFmpegTranscodingTask";

export class FFmpegDriverFactory extends DriverFactory<FFmpegDriver> {
    constructor () {
        super( 'video', 'ffmpeg' );
    }

    create ( server ) : FFmpegDriver {
        const driver = new FFmpegDriver( server );

        driver.factory = this;
        
        return driver;
    }
}

export class FFmpegDriver implements TranscodingDriver {
    server : UnicastServer;

    factory: DriverFactory<this>;
    
    codecs : FFmpegCodecConstants = new FFmpegCodecConstants;

    formats : FFmpegFormatConstants = new FFmpegFormatConstants;

    protected startTime : number = null;

    protected outputDuration : number = null;

    protected videoCodecs : Map<string, string> = new Map;
    
    protected audioCodecs : Map<string, string> = new Map;

    protected constantRateFactor : number = null;

    protected videoBitrates : Map<string, string> = new Map;

    protected audioBitrates : Map<string, string> = new Map;

    protected audioRates : Map<string, string> = new Map;

    protected format : string = null;

    protected preset : string = null;

    protected resolution : [number, number] = null;

    protected mappings : string[] = [];

    protected disabledSubtitles : boolean = false;

    protected disabledAudio : boolean = false;
    
    protected disabledVideo : boolean = false;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }
    
    setStartTime ( time : number ) : this {
        this.startTime = time;
        
        return this;
    }

    setOutputDuration ( time : number ) : this {
        this.outputDuration = time;

        return this;
    }

    setVideoCodec ( codec : string, stream : string = null ) : this {
        this.videoCodecs.set( stream, codec );

        return this;
    }
    
    setConstantRateFactor ( value : number ) : this {
        this.constantRateFactor = value;

        return this;
    }

    setAudioCodec ( codec : string, stream : string = null ) : this {
        this.audioCodecs.set( stream, codec );
        
        return this;
    }

    setVideoBitrate ( bitrate : number | string, stream : string = null ) : this {
        if ( typeof bitrate === 'number' ) {
            bitrate = '' + bitrate;
        }

        this.videoBitrates.set( stream, bitrate );

        return this;
    }

    setAudioBitrate ( bitrate : number | string, stream : string = null ) : this {
        if ( typeof bitrate === 'number' ) {
            bitrate = '' + bitrate;
        }

        this.audioBitrates.set( stream, bitrate );

        return this;
    }

    setAudioRate ( rate : number | string, stream : string = null ) : this {
        if ( typeof rate === 'number' ) {
            rate = '' + rate;
        }

        this.audioRates.set( stream, rate );

        return this;
    }

    setFormat ( format : string ) : this {
        this.format = format;

        return this;
    }

    setPreset ( preset : FFmpegPreset | string ) : this {
        this.preset = preset;
        
        return this;
    }

    setResolution ( width : number, height : number ) : this {
        this.resolution = [ width, height ];
        
        return this;
    }

    setResolutionProportional ( width : number, height : number, originalWidth : number, originalHeight : number ) {
        if ( originalHeight <= height && originalWidth <= width ) {
            return this;
        }

        const ratio = width / height;
        const originalRatio = originalWidth / originalHeight;

        if ( ratio > originalRatio ) {
            // Height is higher
            return this.setResolution( width / ( originalHeight / height ), height );
        } else {
            // Width is higher
            return this.setResolution( width, height / ( originalWidth / width ) );
        }
    }

    addMap ( stream : string ) : this {
        this.mappings.push( stream );
        
        return this;
    }

    setDisabledSubtitles ( disabled : boolean = true ) : this {
        this.disabledSubtitles = disabled;

        return this;
    }

    setDisabledAudio ( disabled : boolean = true ) : this {
        this.disabledAudio = disabled;

        return this;
    }

    setDisabledVideo ( disabled : boolean = true ) : this {
        this.disabledVideo = disabled;

        return this;
    }

    import ( driver : FFmpegDriver ) : this {
        this.factory = driver.factory as any;

        this.videoCodecs = new Map( driver.videoCodecs );
        
        this.audioCodecs = new Map( driver.audioCodecs );
    
        this.constantRateFactor = driver.constantRateFactor;
    
        this.videoBitrates = new Map( driver.videoBitrates );
    
        this.audioBitrates = new Map( driver.audioBitrates );
    
        this.audioRates = new Map( driver.audioRates );
    
        this.format = driver.format;
    
        this.preset = driver.preset;
    
        this.resolution = driver.resolution ? [ driver.resolution[ 0 ], driver.resolution[ 1 ] ] : null;
    
        this.mappings = Array.from( driver.mappings );
    
        this.disabledSubtitles = driver.disabledSubtitles;
    
        this.disabledAudio = driver.disabledAudio;
        
        this.disabledVideo = driver.disabledVideo;

        return this;
    }
    
    getCompiledArguments ( stream : MediaStream ) : string[] {
        const args : string[] = [];

        if ( this.startTime !== null ) {
            args.push( '-ss', '' + this.startTime );
        }

        if ( stream.getInputForDriver( this.factory.name ) ) {
            args.push( '-i', stream.getInputForDriver( this.factory.name ) );
        } else {
            args.push( '-i', 'pipe:0' );
        }

        if ( this.outputDuration !== null ) {
            args.push( '-to', '' + this.outputDuration );
        }

        for ( let [ stream, codec ] of this.videoCodecs ) {
            if ( !stream ) {
                args.push( '-c:v', codec );
            } else {
                args.push( '-c:v:' + stream, codec );
            }
        }

        for ( let [ stream, codec ] of this.audioCodecs ) {
            if ( !stream ) {
                args.push( '-c:a', codec );
            } else {
                args.push( '-c:a:' + stream, codec );
            }
        }

        for ( let [ stream, bitrate ] of this.videoBitrates ) {
            if ( !stream ) {
                args.push( '-b:v', bitrate );
            } else {
                args.push( '-b:v:' + stream, bitrate );
            }
        }

        for ( let [ stream, bitrate ] of this.audioBitrates ) {
            if ( !stream ) {
                args.push( '-b:a', bitrate );
            } else {
                args.push( '-b:a:' + stream, bitrate );
            }
        }

        for ( let [ stream, rate ] of this.audioRates ) {
            if ( !stream ) {
                args.push( '-ar', rate );
            } else {
                args.push( '-ar:' + stream, rate );
            }
        }

        if ( this.constantRateFactor !== null ) {
            args.push( '-crf', '' + this.constantRateFactor );
        }

        if ( this.preset != null ) {
            args.push( '-preset', this.preset );
        }

        if ( this.format != null ) {
            args.push( '-format', this.format );
        }

        if ( this.disabledSubtitles ) {
            args.push( '-sn' );
        }

        if ( this.disabledVideo ) {
            args.push( '-sv' );
        }

        if ( this.disabledAudio ) {
            args.push( '-sa' );
        }

        return args;
    }

    getCommandPath () {
        const customPath = this.server.config.get( 'ffmpeg.path' );
        
        if ( customPath ) {
            return customPath + '\\' + 'ffmpeg.exe';
        }

        return 'ffmpeg';
    }

    spawn ( stream : MediaStream ) : FFmpegTranscodingTask {
        const args = this.getCompiledArguments( stream );

        const child = spawn( this.getCommandPath(), args );

        const task = new FFmpegTranscodingTask( child );

        return task;
    }
}

export class FFmpegCodecConstants {
    video = {
        h264: 'libx264',
        h265: 'libx265',
        hevc: 'libx265',
        webp: 'libwebp',
        xvid: 'libxvid',
        mpeg2: 'mpeg2',
        vp9: 'libvpx',
        png: 'png',
        prores: 'prores-aw'
    };

    audio = {
        aac: 'aac',
        ac3: 'ac3',
        flac: 'flac',
        mp3: 'libmp3lame',
        opus: 'libopus',
        vorbis: 'libvorbis'
    };
}

export class FFmpegFormatConstants {
    matroska = 'matroska';

    mkv = 'matroska';

    hls = 'hls';

    avi = 'avi';

    mov = 'mov';

    mp4 = 'mp4';

    mp3 = 'mp3';

    mpegts = 'mpegts';
}

export enum FFmpegPreset {
    UltraFast = 'ultrafast',
    SuperFast = 'superfast',
    VeryFast = 'veryfast',
    Faster = 'faster',
    Fast = 'fast',
    Medium = 'medium',
    Slow = 'slow',
    Slower = 'slower',
    VerySlow = 'veryslow',
    Placebo = 'placebo'
}