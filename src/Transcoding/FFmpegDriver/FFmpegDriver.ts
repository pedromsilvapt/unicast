import { TranscodingDriver, TranscodingBackgroundTask } from "../TranscodingDriver";
import { DriverFactory } from "../DriverFactory";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { UnicastServer } from "../../UnicastServer";
import { spawn } from 'child_process';
import { FFmpegTranscodingTask } from "./FFmpegTranscodingTask";
import { MediaTrigger } from "../../TriggerDb";
import { boxblur, source, Stream, concat, silence, blackout, mute, sources, filters } from 'composable';
import { StaticStream } from "composable/lib/Stream";
import { Compiler, EmissionsFragment, compile } from "composable/lib/Compiler/Compiler";
import { MediaMetadata, TrackMediaMetadata } from "../../MediaTools";
import * as path from 'path';
import { MediaRecord } from "../../MediaRecord";

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

    protected threads : number = 0;

    protected videoCodecs : Map<string, FFMpegVideoEncoder> = new Map;
    
    protected audioCodecs : Map<string, FFMpegAudioEncoder> = new Map;

    protected constantRateFactor : number = null;

    protected maximumCompression : number = null;

    protected minimumCompression : number = null;

    protected videoBitrates : Map<string, string> = new Map;

    protected audioBitrates : Map<string, string> = new Map;

    protected audioRates : Map<string, string> = new Map;

    protected format : string = null;

    protected preset : string = null;

    protected resolution : [number, number] = null;

    protected mappings : (string | Stream)[] = [];

    protected disabledSubtitles : boolean = false;

    protected disabledAudio : boolean = false;
    
    protected disabledVideo : boolean = false;

    protected framerate : number;

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

    setFramerate ( framerate : number ) {
        this.framerate = framerate;
        
        return this;
    }

    getFramerate () : number {
        return this.framerate;
    }

    setVideoCodec ( codec : FFMpegVideoEncoder, stream : string = null ) : this {
        this.videoCodecs.set( stream, codec );

        return this;
    }
    
    setConstantRateFactor ( value : number ) : this {
        this.constantRateFactor = value;

        return this;
    }

    setMaximumCompression ( value : number ) : this {
        this.maximumCompression = value;

        return this;
    }

    setMinimumCompression ( value : number ) : this {
        this.minimumCompression = value;

        return this;
    }

    setAudioCodec ( codec : FFMpegAudioEncoder, stream : string = null ) : this {
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

    setThreads ( threads : number ) : this {
        this.threads = threads;
        
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

    addMap ( ...stream : (string | Stream)[] ) : this {
        this.mappings.push( ...stream );
        
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
    
    setTriggers ( triggers : MediaTrigger[], videoMetadata : TrackMediaMetadata, inputVideo : string, inputAudio : string, duration : number ) : this {
        const inputAudioStream = new StaticStream( null, inputAudio );

        const inputVideoStream = new StaticStream( null, inputVideo );

        let [ audio, video ] : [ Stream, Stream ] = [ inputAudioStream, inputVideoStream ];

        for ( let trigger of triggers ) {
            for ( let timestamp of trigger.timestamps ) {
                const enable = `'between(t,${ timestamp.start },${ timestamp.end })'`;

                if ( timestamp.type === 'lightblur' ) {
                    video = boxblur( video, { luma_radius: 20, enable } );
                } else if ( timestamp.type === 'blur' ) {
                    video = boxblur( video, { luma_radius: 40, enable } );
                } else if ( timestamp.type === 'heavyblur' ) {
                    video = boxblur( video, { luma_radius: 60, enable } );
                } else if ( timestamp.type === 'black' ) {
                    video = blackout( video, videoMetadata.width, videoMetadata.height, timestamp.start, timestamp.end );
                }

                if ( timestamp.mute ) {
                    // audio = volume( audio, 0, { enable } );
                    audio = mute( audio, timestamp.start, timestamp.end );
                }
            }
        }

        this.addMap( video, audio );

        return this;
    }

    import ( driver : FFmpegDriver ) : this {
        this.factory = driver.factory as any;

        this.threads = driver.threads;

        this.framerate = driver.framerate;

        this.videoCodecs = new Map( driver.videoCodecs );
        
        this.audioCodecs = new Map( driver.audioCodecs );
    
        this.constantRateFactor = driver.constantRateFactor;
    
        this.maximumCompression = driver.maximumCompression;

        this.minimumCompression = driver.minimumCompression;

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
    
    getCompiledArguments ( record : MediaRecord, stream : MediaStream ) : string[] {
        const args : string[] = [];

        if ( this.startTime !== null ) {
            args.push( '-ss', '' + this.startTime );
        }

        args.push( '-i', this.server.getUrl( this.server.streams.getUrlFor( record.kind, record.id, stream.id ) ) );

        // if ( stream.getInputForDriver( this.factory.name ) ) {
        //     args.push( '-i', stream.getInputForDriver( this.factory.name ) );
        // } else {
        //     args.push( '-i', 'pipe:0' );
        // }

        if ( this.threads != 0 ) {
            args.push( '-threads', '' + this.threads );
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

        if ( this.framerate ) {
            args.push( '-r', '' + this.framerate );
        }

        if ( this.constantRateFactor !== null ) {
            if ( this.maximumCompression == null && this.minimumCompression == null ) {
                args.push( '-crf', '' + this.constantRateFactor );
            } else {
                args.push( '-rc', 'vbr' );

                if ( this.minimumCompression != null ) args.push( '-qmin', '' + this.minimumCompression );
                if ( this.maximumCompression != null ) args.push( '-qmax', '' + this.maximumCompression );
            }
            // args.push( '-qp', '' + this.constantRateFactor );
            // args.push( '-cq', '' + this.constantRateFactor );
            // args.push( '-b:v', '22M' );
            // args.push( '-q', '22' )
            
            // args.push( '-maxrate', '220M' );
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

        let filtersComplex : string[] = [];

        let maps : string[] = [];

        if ( this.mappings.length ) {
            const compiler = new Compiler( [] );

            const dynamicStreams : Stream[] = [];

            for ( let stream of this.mappings ) {
                if ( typeof stream === 'string' ) {
                    maps.push( '-map', stream );
                } else {
                    maps.push( '-map', '[' + stream.compile( compiler ) + ']' );
                    
                    dynamicStreams.push( stream );
                }
            }

            if ( dynamicStreams.length ) {
                filtersComplex.push( filters( dynamicStreams ).compile( compiler ).slice( 1, -1 ) );
        
                if ( filtersComplex.length ) {
                    args.push( '-filter_complex', filtersComplex.join( ';' ) );
                }
            }

            args.push( ...maps );
        }

        return args;
    }

    getCommandPath () {
        const customPath = this.server.config.get( 'ffmpeg.path' );

        if ( customPath ) {
            return path.join( customPath, 'ffmpeg.exe' );
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

export enum FFMpegVideoEncoder {
    x264 = 'libx264',
    NvencH264 = 'h264_nvenc',
    x265 = 'libx265',
    HEVC = 'libx265',
    NvencHEVC = 'hevc_nvenc',
    WebP = 'libwebp',
    XviD = 'libxvid',
    MPEG2 = 'mpeg2',
    VP9 = 'libvpx',
    PNG = 'png',
    ProRes = 'prores-aw'
}

export enum FFMpegAudioEncoder {
    AAC = 'aac',
    AC3 = 'ac3',
    FLAC = 'flac',
    MP3 = 'libmp3lame',
    Opus = 'libopus',
    Vorbis = 'libvorbis'
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