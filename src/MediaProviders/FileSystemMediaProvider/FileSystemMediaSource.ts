import { MediaSource } from "../MediaSource";
import { MediaStream } from "../MediaStreams/MediaStream";
import { MediaRecord } from "../../MediaRecord";
import * as isSubtitle from 'is-subtitle';
import * as isVideo from 'is-video';
import * as path from 'path';
import * as fs from 'mz/fs';
import { FileSystemVideoMediaStream } from "./MediaStreams/FileSystemVideoStream";
import { FileSystemSubtitlesMediaStream } from "./MediaStreams/FileSystemSubtitlesStream";
import { MediaTools } from "../../MediaTools";

export class FileSystemMediaSource extends MediaSource {
    async scan () : Promise<MediaStream[]> {
        const file : string = this.details.id;

        const streams : MediaStream[] = [];

        if ( !( await fs.exists( file ) ) ) {
            return [];
        }

        if ( isVideo( file ) ) {
            const metadata = await MediaTools.probe( file );

            streams.push( new FileSystemVideoMediaStream( file, this, metadata ) );

            // TODO Re-enable embedded subtitle streams
            // const subtitles = metadata.tracks.filter( track => track.type == 'subtitle' );

            // for ( let track of subtitles ) {
            //     // TODO Read metadata here and create embedded subtitle streams
            //     streams.push( new FileSystemEmbeddedSubtitleStream( this, `${file}?${track.index}`, this.source, track ) );
            // }

            const folder = path.dirname( file );

            const filePrefix = path.basename( file, path.extname( file ) );

            const otherFiles = await fs.readdir( folder );
            
            const matchingFiles = otherFiles
                .filter( file => file.startsWith( filePrefix ) )
                .filter( file => isSubtitle( file ) );

            for ( let file of matchingFiles ) {
                streams.push( new FileSystemSubtitlesMediaStream( path.join( folder, file ), this ) );
        }
        }

        if ( isSubtitle( file ) ) {
            streams.push( new FileSystemSubtitlesMediaStream( file, this ) );
        }

        return streams;
    }

    info () : Promise<MediaRecord> {
        return Promise.resolve( null );
    }
}