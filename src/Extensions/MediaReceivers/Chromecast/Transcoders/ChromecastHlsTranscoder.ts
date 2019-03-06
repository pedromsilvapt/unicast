import { ChromecastReceiver } from "../ChromecastReceiver";
import { MediaStream, MediaStreamType } from "../../../../MediaProviders/MediaStreams/MediaStream";
import { VideoMediaStream } from "../../../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegPreset, FFMpegVideoEncoder, FFMpegAudioEncoder } from "../../../../Transcoding/FFmpegDriver/FFmpegDriver";
import { Transcoder, TranscodingSession } from "../../../../Transcoding/Transcoder";
import { FFmpegHlsDriver, FFmpegHlsFlag, FFmpegHlsPlaylistType } from "../../../../Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";
import { HlsVideoMediaStream } from "../../../../Transcoding/FFmpegHlsDriver/HlsVideoMediaStream";
import { MediaRecord } from "../../../../MediaRecord";
import { HistoryRecord } from "../../../../Database/Database";
import { CancelToken } from 'data-cancel-token';
import { MediaTrigger } from "../../../../TriggerDb";
import { TrackMediaMetadata, FileMediaMetadata } from "../../../../MediaTools";
import * as chalk from 'chalk';
import { evaluate } from "../../../../Config";
import { DataAmount } from '../../../../ES2017/Units';

export class ChromecastHlsTranscoder extends Transcoder<ChromecastTranscoderOptions> {
    receiver : ChromecastReceiver;

    options : ChromecastTranscoderOptions;

    constructor ( receiver : ChromecastReceiver, options : Partial<ChromecastTranscoderOptions> = {} ) {
        super();

        this.receiver = receiver;

        this.options = evaluate<ChromecastTranscoderOptions>( {
            segmentLength: 3,
            maxBitrate: 12000000,
            constantRateFactor: 18,
            minimumCompression: ops => ops.defaultVideoEncoder == FFMpegVideoEncoder.NvencH264 ? 20 : null,
            maximumCompression: ops => ops.defaultVideoEncoder == FFMpegVideoEncoder.NvencH264 ? 28 : null,
            maxSegmentSize: '5mb',
            maxResolution: { width: 1920, height : 1080 },
            supportedVideoCodecs: [ 'h264' ],
            supportedAudioCodecs: [ 'aac', 'ac3' ],
            defaultVideoEncoder: FFMpegVideoEncoder.x264,
            defaultAudioEncoder: FFMpegAudioEncoder.AAC,
            forceVideoTranscoding: false,
            forceAudioTranscoding: false,
            preset: options => options.defaultVideoEncoder == FFMpegVideoEncoder.NvencH264 
                ? FFmpegPreset.Slow 
                : FFmpegPreset.Faster,
            threads: 7,
        }, options );
    }

    printDiagnosticsLine ( ...segments : ( string | number )[] ) {
        console.log( ...segments );
    }

    printDiagnosticsTranscodingReport ( file : FileMediaMetadata, video : TrackMediaMetadata, audio : TrackMediaMetadata, conditionVideo : boolean, conditionAudio : boolean, options : ChromecastTranscoderOptions, triggers : any[] ) {
        const ltrue = chalk.green( 'true' );
        const lfalse = chalk.red( 'false' );
        const lbool = ( flag : boolean ) => flag ? ltrue : lfalse;
        const lname = ( name : string ) => chalk.grey( name );
        const lvalue = ( value : any ) => chalk.yellow( value );

        this.printDiagnosticsLine( 'TRANSCODING ENABLED:', lbool( conditionVideo || conditionAudio ) );
        this.printDiagnosticsLine( lname( '# bitrate:' ), lbool( ( file.format.bitrate || video.bitrate ) > options.maxBitrate ), lvalue( ( file.format.bitrate || video.bitrate ) ), '>', lvalue( options.maxBitrate ) );
        this.printDiagnosticsLine( lname( '# video codec:' ), lbool( options.supportedVideoCodecs.every( c => c !== video.codec ) ), lvalue( video.codec ), `(allowed ${ options.supportedVideoCodecs.join( ', ' ) })` );
        this.printDiagnosticsLine( lname( '# audio codec:' ), lbool( options.supportedAudioCodecs.every( c => c !== audio.codec ) ), lvalue( audio.codec ), `(allowed ${ options.supportedAudioCodecs.join( ', ' ) })` );
        this.printDiagnosticsLine( lname( '# resolution width:' ), lbool( video.width > options.maxResolution.width ), lvalue( video.width ), '>', lvalue( options.maxResolution.width ) );
        this.printDiagnosticsLine( lname( '# resolution height:' ), lbool( video.height > options.maxResolution.height ), lvalue( video.height ), '>', lvalue( options.maxResolution.height ) );
        this.printDiagnosticsLine( lname( '# forced video transcoding:' ), lbool( options.forceVideoTranscoding ) );
        this.printDiagnosticsLine( lname( '# force audio transcoding:' ), lbool( options.forceAudioTranscoding ) );
        this.printDiagnosticsLine( lname( '# triggers:' ), triggers.length > 0 ? ltrue : lfalse, `(${ lvalue( triggers.length ) })` );
    }

    async transcodeVideo ( transcoding : TranscodingSession<ChromecastTranscoderOptions>, session : HistoryRecord, media : MediaRecord, stream : VideoMediaStream, customOptions : Partial<ChromecastTranscoderOptions> = {}, cancel ?: CancelToken ) : Promise<VideoMediaStream> {
        if ( !stream.metadata ) {
            return stream;
        }

        const triggers : MediaTrigger[] = await this.receiver.server.triggerdb.queryMediaRecord( media );

        const options = { ...this.options, customOptions };

        const video = stream.metadata.tracks.find( track => track.type === 'video' );
        const audio = stream.metadata.tracks.find( track => track.type === 'audio' );

        const conditionBitrate : boolean = ( stream.metadata.files[ 0 ].format.bitrate || video.bitrate ) > options.maxBitrate;
        const conditionVideoCodec : boolean = options.supportedVideoCodecs.every( c => c !== video.codec );
        const conditionAudioCodec : boolean = options.supportedAudioCodecs.every( c => c !== audio.codec );
        const conditionResolution : boolean = video.width > options.maxResolution.width || video.height > options.maxResolution.height;

        const conditionVideo : boolean = conditionBitrate || conditionVideoCodec || conditionResolution || options.forceVideoTranscoding || triggers.length > 0;
        const conditionAudio : boolean = conditionAudioCodec || options.forceAudioTranscoding;

        const driver = this.receiver.server.transcoding.getDriverFor<FFmpegHlsDriver>( 'video', 'ffmpeg-hls' );

        this.printDiagnosticsTranscodingReport( stream.metadata.files[ 0 ], video, audio, conditionVideo, conditionAudio, options, triggers );

        if ( conditionVideo || conditionAudio ) {
            driver.setVideoCodec( options.defaultVideoEncoder );

            if ( conditionResolution ) {
                driver.setResolutionProportional( 
                    options.maxResolution.width,
                    options.maxResolution.height,
                    video.width,
                    video.height
                );
            }
            
            driver.setConstantRateFactor( options.constantRateFactor );
            
            driver.setSegmentDuration( options.segmentLength );

            driver.setMaxSegmentSize( DataAmount.parse( options.maxSegmentSize ) );

            driver.setForceKeyFrames( true );

            driver.setCopyTimestamps( true );

            driver.setDisabledSubtitles( false );
            
            driver.setHlsFlags( [ FFmpegHlsFlag.SplitByTime ] );
            
            driver.setSegmentListSize( 0 );
            
            driver.setHlsPlaylistType( FFmpegHlsPlaylistType.Event );

            if ( triggers.length > 0 ) {
                driver.setTriggers( triggers, video );
            } else {
                driver.addMap( '0:v:0', '0:a:0' );
            }
            
            driver.setThreads( options.threads );

            driver.setPreset( options.preset );

            driver.setFramerate( video.framerate );
        }

        if ( conditionAudio || conditionVideo ) {
            driver.setAudioCodec( options.defaultAudioEncoder );
        }

        if ( conditionAudio || conditionVideo ) {
            const hls = new HlsVideoMediaStream( session, driver, stream, this.receiver.server.storage );
            
            await hls.init();
            
            this.receiver.server.tasks.register( hls.task );

            transcoding.addStreamsMapping( stream, hls, hls.task );

            return hls;
        }
    }

    async transcode ( session : HistoryRecord, media : MediaRecord, streams : MediaStream[], customOptions : Partial<ChromecastTranscoderOptions> = {}, cancel ?: CancelToken ) : Promise<TranscodingSession<ChromecastTranscoderOptions>> {
        const transcoding = new TranscodingSession( null, customOptions, streams );

        await Promise.all( streams.map( async stream => {
            if ( VideoMediaStream.is( stream ) ) {
                await this.transcodeVideo( transcoding, session, media, stream, customOptions, cancel );
            }
        } ) );

        if ( transcoding.isPristine ) {
            return null;
        }

        return transcoding;
    }
}

export interface ChromecastTranscoderOptions {
    segmentLength : number;
    maxSegmentSize : number | string | DataAmount;
    maxBitrate : number;
    constantRateFactor : number;
    minimumCompression: number;
    maximumCompression: number;
    maxResolution : { width: number, height : number };
    supportedVideoCodecs : string[];
    supportedAudioCodecs : string[];
    defaultVideoEncoder : FFMpegVideoEncoder;
    defaultAudioEncoder : FFMpegAudioEncoder;
    forceVideoTranscoding : boolean;
    forceAudioTranscoding : boolean;
    preset : FFmpegPreset;
    threads: number;
}