import { LoggerInterface } from 'clui-logger';
import { FileSystemRepository } from '../../MediaRepositories/FileSystem/FileSystemRepository';
import { PlayableMediaRecord } from '../../../MediaRecord';
import { MediaTools } from '../../../MediaTools';
import { UnicastServer } from '../../../UnicastServer';
import { ISubtitlesProvider, ISubtitle, SearchOptions } from '../../../Subtitles/Providers/ISubtitlesProvider';
import { fs } from 'mz';
import { spawn } from 'child_process';
import { waitForProcess } from '../../../ES2017/ChildProcess';
import { Stopwatch } from '../../../BackgroundTask';
import * as path from 'path';

export interface IEmbeddedSubtitlesResult extends ISubtitle {
    filePath: string;
    trackIndex: number;
}

export interface IEmbeddedSubtitlesConfig {
    enabled?: boolean;
    showExtractionOutput: boolean;
}

export class EmbeddedSubtitlesProvider implements ISubtitlesProvider<IEmbeddedSubtitlesResult> {
    readonly name: string = 'embedded';

    server: UnicastServer;

    logger: LoggerInterface;

    config : IEmbeddedSubtitlesConfig;

    public constructor ( config : Partial<IEmbeddedSubtitlesConfig> ) {
        this.config = {
            showExtractionOutput: false,
            ...config
        };
    }

    onEntityInit () {
        this.logger = this.server.logger.service( `Subtitles/Providers/${ this.name }` );
    }

    async search ( media: PlayableMediaRecord, searchOptions: SearchOptions ): Promise<IEmbeddedSubtitlesResult[]> {
        const repository = this.server.repositories.get( media.repository );

        if ( repository instanceof FileSystemRepository ) {
            const videoPath = await repository.getRealFilePath( media );

            if ( videoPath != null ) {
                if ( await fs.exists( videoPath ) ) {
                    const metadata = await this.server.mediaTools.probe( videoPath );

                    const subtitles = metadata.tracks.filter( track => track.type === 'subtitle' );

                    const stat = await fs.stat( videoPath );

                    return subtitles
                        .filter( subtitle => !subtitle.language || subtitle.language == searchOptions.lang )
                        .map( subtitle => ( {
                            id: this.server.hash( videoPath + subtitle.index.toString() ),
                            releaseName : subtitle.title || `Track ${subtitle.typeIndex + 1}`,
                            encoding : null,
                            format : 'srt' || subtitle.codec,
                            language : subtitle.language,
                            publishedAt : stat.atime,
                            downloads : 0,
                            provider : this.name,
                            score : 1,

                            filePath: videoPath,
                            trackIndex: subtitle.index,
                        } ) );
                } else {
                    const humanizedTitle = await this.server.media.humanize( media );

                    this.logger.warn( `Media ${ humanizedTitle } could not locate file path "${ videoPath }".` );
                }
            } else {
                const humanizedTitle = await this.server.media.humanize( media );

                this.logger.warn( `Media ${ humanizedTitle } provided by FileSystemRepository could not resolve file path.` );
            }
        }

        return [];
    }

    async download ( subtitle: IEmbeddedSubtitlesResult ): Promise<NodeJS.ReadableStream> {
        const tempFolder = await this.server.storage.getRandomFolder('embedded-subtitle');

        const subtitleExtension = subtitle.format;

        const tempFile = `${ path.basename( subtitle.filePath, path.extname( subtitle.filePath ) ) }.${ subtitleExtension }`;

        const processArgs = [
            '-i',
            subtitle.filePath,
            '-map',
            `0:${ subtitle.trackIndex }`,
            path.join( tempFolder, tempFile ),
        ];

        this.logger.info( 'Extracting: ' + subtitle.filePath );

        const command = this.server.mediaTools.getCommandPath( "ffmpeg" );

        const cp = spawn( command, processArgs, {
            stdio: this.config.showExtractionOutput ? 'inherit' : 'ignore'
        } );

        await waitForProcess( cp );

        this.logger.info( 'Extracted to ' + path.relative( this.server.storage.getPath(), tempFile ) );

        process.stdout.write('\x07');

        return fs.createReadStream( path.join( tempFolder, tempFile ) );
    }
}
