import { Tool, ToolOption } from "./Tool";
import { AllMediaKinds, MediaKind, isPlayableRecord } from '../MediaRecord';
import { MediaStreamSelectors } from '../MediaProviders/MediaStreams/MediaStreamSelectors';
import { FFmpegDriver, Scene } from '../Transcoding/FFmpegDriver/FFmpegDriver';
import { FFmpegTranscodingTask } from '../Transcoding/FFmpegDriver/FFmpegTranscodingTask';
import { MediaTrigger } from '../TriggerDb';
import { MpvPlayer } from '../Subtitles/Validate/MPV/Player';
import { Duration, DurationUnit } from '../ES2017/Units';
import { ProgressBarLiveComponent } from '../ES2017/ProgressBarArea';

export interface PreviewTriggersOptions {
    kind : MediaKind;
    id : string;
}

export class PreviewTriggersTool extends Tool<PreviewTriggersOptions> {
    getParameters () {
        return [
            new ToolOption( 'kind' ).setRequired( true ).setAllowedValues( AllMediaKinds ),
            new ToolOption( 'id' ).setRequired( true )
        ];
    }

    getScenes ( triggers : MediaTrigger[], offset : number = 0 ) : Scene[] {
        return triggers.map( trigger => trigger.timestamps.map( timestamp => ( {
            start: timestamp.start - offset,
            end: timestamp.end + offset
        } ) ) ).reduce( ( a, b ) => a.concat( b ), [] )
    }
    
    async run ( options : PreviewTriggersOptions ) {
        await this.launchServer();

        const media = await this.server.media.get( options.kind, options.id );

        if ( !isPlayableRecord( media ) ) {
            throw new Error( 'Media kind is not playable.' );
        }

        const stream = MediaStreamSelectors.firstVideo( await this.server.providers.streams( media.sources ) );

        if ( !stream ) {
            throw new Error( 'The selected media does not provide a video stream.' );
        }

        this.log( "Media found:", media.title );
        
        this.log( "Loading triggers..." );
        
        const triggers = await this.server.triggerdb.queryMediaRecord( media );

        const timestamps = this.getScenes( triggers, 3 );
        
        const duration = new Duration( timestamps.map( scene => scene.end - scene.start ).reduce( ( a, b ) => a + b, 0 ), DurationUnit.SECONDS );

        if ( triggers.length === 0 ) {
            throw new Error( 'No triggers/timestamps were found for this media.' );
        }

        this.log( `${ triggers.length } triggers, ${ timestamps.length } timestamps found.` );
        
        const driver = new FFmpegDriver( this.server );

        driver.setScenes( timestamps, stream.duration );

        driver.setTriggers( triggers, stream.metadata.tracks.find( track => track.type === 'video' ) );

        const folder = await this.server.storage.getRandomFolder( 'preview-triggers-' );

        this.log( 'Saving file to ', folder );

        const task = FFmpegTranscodingTask.launch( media, stream, driver, folder );

        task.encoder.on( 'error', error => console.error( error ) );

        // Progress Bar
        const progressBar = new ProgressBarLiveComponent( {
            progress: 0,
            title: 'Transcoding file...',
            rightLabel: duration.toHumanString( false )
        } ).hook();

        task.encoder.on( 'encoding-progress', progress => progressBar.setState( {
            progress: progress.percentage,
            leftLabel: progress.time.toHumanString( false )
        } ) );

        await task.encoder.wait();

        progressBar.close();

        this.log( 'Launching video...' );

        const player = MpvPlayer.fromServer( this.server, folder + '\\video.mkv' );

        await player.run().wait();

        this.log( 'Video terminated.' );
    }
}