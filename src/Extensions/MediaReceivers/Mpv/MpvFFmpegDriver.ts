import { FFmpegDriver } from '../../../Transcoding/FFmpegDriver/FFmpegDriver';
import { MediaTrigger } from '../../../TriggerDb';
import { UnicastServer } from '../../../UnicastServer';
import { TrackMediaProbe } from '../../../MediaTools';
import { Compiler } from 'composable';

export class MpvFFmpegDriver extends FFmpegDriver {
    public static getFilterGraph ( server : UnicastServer, triggers : MediaTrigger[], videoMetadata : TrackMediaProbe ) {
        const driver = new MpvFFmpegDriver( server );

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
