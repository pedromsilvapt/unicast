import { ChromecastReceiver } from "../ChromecastReceiver";
import { MediaStream, MediaStreamType } from "../../../MediaProviders/MediaStreams/MediaStream";
import { VideoMediaStream } from "../../../MediaProviders/MediaStreams/VideoStream";
import { FFmpegDriver, FFmpegPreset } from "../../../Transcoding/FFmpegDriver/FFmpegDriver";
import { Transcoder } from "../../../Transcoding/Transcoder";
import { FFmpegHlsDriver, FFmpegHlsFlag, FFmpegHlsPlaylistType } from "../../../Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";
import { HlsVideoMediaStream } from "../../../Transcoding/FFmpegHlsDriver/HlsVideoMediaStream";
import { MediaRecord } from "../../../MediaRecord";
import { HistoryRecord } from "../../../Database";
import { CancelToken } from 'data-cancel-token';
import { MediaTrigger } from "../../../TriggerDb";

export class ChromecastHlsTranscoder extends Transcoder<ChromecastTranscoderOptions> {
    receiver : ChromecastReceiver;

    options : ChromecastTranscoderOptions;

    constructor ( receiver : ChromecastReceiver, options : Partial<ChromecastTranscoderOptions> = {} ) {
        super();

        this.receiver = receiver;

        this.options = {
            segmentSize: 3,
            maxBitrate: 9000000,
            constantRateFactor: 22,
            maxResolution: { width: 1920, height : 1080 },
            supportedVideoCodecs: [ 'h264' ],
            supportedAudioCodecs: [ 'aac', 'ac3' ],
            defaultVideoCodec: 'libx264',
            defaultAudioCodec: 'aac',
            forceVideoTranscoding: false,
            forceAudioTranscoding: false,
            ...options
        };
    }

    async transcodeVideo ( session : HistoryRecord, media : MediaRecord, stream : VideoMediaStream, customOptions : Partial<ChromecastTranscoderOptions> = {}, cancel ?: CancelToken ) : Promise<VideoMediaStream> {
        const triggers : MediaTrigger[] = await this.receiver.server.triggerdb.queryMediaRecord( media );

        const options = { ...this.options, customOptions };

        const video = stream.metadata.tracks.find( track => track.type === 'video' );
        const audio = stream.metadata.tracks.find( track => track.type === 'audio' );

        const conditionBitrate : boolean = ( video.bitrate || stream.metadata.files[ 0 ].format.bitrate ) > options.maxBitrate;
        const conditionVideoCodec : boolean = options.supportedVideoCodecs.every( c => c !== video.codec );
        const conditionAudioCodec : boolean = options.supportedAudioCodecs.every( c => c !== audio.codec );
        const conditionResolution : boolean = video.width > options.maxResolution.width || video.height > options.maxResolution.height;

        const conditionVideo : boolean = conditionBitrate || conditionVideoCodec || conditionResolution || options.forceVideoTranscoding || triggers.length > 0;
        const conditionAudio : boolean = conditionAudioCodec || options.forceAudioTranscoding;

        const driver = this.receiver.server.transcoding.getDriverFor<FFmpegHlsDriver>( 'video', 'ffmpeg-hls' );

        if ( conditionVideo || conditionAudio ) {
            driver.setVideoCodec( options.defaultVideoCodec );

            if ( conditionResolution ) {
                driver.setResolutionProportional( 
                    options.maxResolution.width,
                    options.maxResolution.height,
                    video.width,
                    video.height
                );
            }
            
            driver.setConstantRateFactor( options.constantRateFactor );
            
            driver.setSegmentDuration( options.segmentSize );

            driver.setForceKeyFrames( true );

            driver.setCopyTimestamps( true );

            driver.setDisabledSubtitles( false );
            
            driver.setHlsFlags( [ FFmpegHlsFlag.SplitByTime ] );
            
            driver.setSegmentListSize( 0 );
            
            driver.setHlsPlaylistType( FFmpegHlsPlaylistType.Event );

            if ( triggers.length > 0 ) {
                driver.setTriggers( triggers, video, '0:v:0', '0:a:0', video.duration );
            } else {
                driver.addMap( '0:v:0', '0:a:0' );
            }
            
            driver.setPreset( FFmpegPreset.Faster );
        }

        if ( conditionAudio || conditionVideo ) {
            driver.setAudioCodec( options.defaultAudioCodec );
        }

        if ( conditionAudio || conditionVideo ) {
            const hls = new HlsVideoMediaStream( session, driver, stream, this.receiver.server.storage );
            
            await hls.init();
            
            this.receiver.server.tasks.register( hls.task );

            return hls;
        }

        return stream;
    }

    async transcode ( session : HistoryRecord, media : MediaRecord, streams : MediaStream[], customOptions : Partial<ChromecastTranscoderOptions> = {}, cancel ?: CancelToken ) : Promise<MediaStream[]> {
        return Promise.all( streams.map( stream => {
            if ( stream.type === MediaStreamType.Video ) {
                return this.transcodeVideo( session, media, stream as VideoMediaStream, customOptions, cancel );
            }

            return Promise.resolve( stream );
        } ) );
    }
}

export interface ChromecastTranscoderOptions {
    segmentSize : number;
    maxBitrate : number;
    constantRateFactor : number;
    maxResolution : { width: number, height : number };
    supportedVideoCodecs : string[];
    supportedAudioCodecs : string[];
    defaultVideoCodec : string;
    defaultAudioCodec : string;
    forceVideoTranscoding : boolean;
    forceAudioTranscoding : boolean;
}