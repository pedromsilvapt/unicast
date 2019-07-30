import { FFmpegDriver } from '../../../Transcoding/FFmpegDriver/FFmpegDriver';
import { MediaTrigger } from '../../../TriggerDb';
import { UnicastServer } from '../../../UnicastServer';
import { TrackMediaMetadata, MediaMetadata } from '../../../MediaTools';
import { OutputStream, compile, Compiler, filters } from 'composable';
import { StaticStream } from 'composable/lib/Stream';

export class MpvFFmpegDriver extends FFmpegDriver {
    public static getFilterGraph ( server : UnicastServer, triggers : MediaTrigger[], videoMetadata : TrackMediaMetadata ) {
        const driver = new MpvFFMpegDriver( server );

        driver.setMap( 'vid1', 'aid1' );

        driver.setTriggers( triggers, videoMetadata );

        const [ video, audio ] = driver.getMap();

        const compiler = new Compiler( [] );

        compiler.streams.cache.set( video, 'vo' );
        compiler.streams.cache.set( audio, 'ao' );

        compiler.compile( video );
        compiler.compile( audio );

        return compiler.getEmissionsFor( 'filter' ).join( ';' );
    }
}