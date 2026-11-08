import { LoggerInterface } from 'clui-logger';
import { FileSystemRepository } from '../../MediaRepositories/FileSystem/FileSystemRepository';
import { PlayableMediaRecord } from '../../../MediaRecord';
import {MediaTools, TrackMediaProbe} from '../../../MediaTools';
import { UnicastServer } from '../../../UnicastServer';
import { ISubtitlesProvider, ISubtitle, SearchOptions } from '../../../Subtitles/Providers/ISubtitlesProvider';
import { fs } from 'mz';
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

                    const buildTrackTitle = (subtitle : TrackMediaProbe) => {
                        let title = subtitle.title || `Track ${subtitle.typeIndex + 1}`;

                        const properties = {
                            forced: subtitle.forced ? 'yes' : 'no',
                            default: subtitle.default ? 'yes' : 'no',
                            sdh: subtitle.hearingImpaired ? 'yes' : 'no'
                        }

                        const propertiesDefined = Object
                            .keys(properties)
                            .filter(key => properties[key] != null)
                            .map(key => `${key}: ${properties[key]}`);

                        if (propertiesDefined.length > 0) {
                            title +=  ` (${propertiesDefined.join(', ')})`;
                        }

                        return title;
                    };

                    return subtitles
                        .filter( subtitle => !subtitle.language || subtitle.language == searchOptions.lang )
                        .map( subtitle => ( {
                            id: this.server.hash( videoPath + subtitle.index.toString() ),
                            releaseName : buildTrackTitle(subtitle),
                            encoding : null,
                            format : 'srt', // subtitle.codec,
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

        const tempFile = path.join( tempFolder, `${ path.basename( subtitle.filePath, path.extname( subtitle.filePath ) ) }.${ subtitleExtension }` );

        await this.extract( subtitle, tempFile );

        this.logger.info( 'Extracted to ' + this.server.storage.getRelativePath( tempFile ) );

        process.stdout.write('\x07');

        return fs.createReadStream( tempFile );
    }

    /**
     * Extracts the subtitle track into a local file. ffmpeg writes the subtitles to stdout, so the
     * same code works whether the command runs locally or remotely (where the local file is not reachable).
     */
    protected async extract ( subtitle : IEmbeddedSubtitlesResult, outputFile : string ) : Promise<void> {
        const runner = this.server.mediaTools.resolveRunner( subtitle.filePath );

        this.logger.info( `Extracting${ runner.remote ? ` via ${ runner.name }` : '' }: ${ subtitle.filePath }` );

        const args = [
            '-nostdin',
            // When the output is not shown, only errors are needed (to build the error message)
            ...( this.config.showExtractionOutput ? [] : [ '-loglevel', 'error' ] ),
            '-i', runner.mapPath( subtitle.filePath ),
            '-map', `0:${ subtitle.trackIndex }`,
            '-f', subtitle.format,
            'pipe:1',
        ];

        const cp = runner.spawn( runner.getCommandPath( 'ffmpeg' ), args, {
            // stdout receives the subtitles, stderr is kept for error messages.
            // stdin is never read by ffmpeg (the ssh runner overrides it with its own pipe)
            stdio: [ 'ignore', 'pipe', 'pipe' ]
        } );

        let stderr = '';

        cp.stderr.on( 'data', ( chunk : Buffer ) => {
            if ( this.config.showExtractionOutput ) {
                process.stderr.write( chunk );
            }

            if ( stderr.length < 10000 ) {
                stderr += chunk.toString();
            }
        } );

        const output = fs.createWriteStream( outputFile );

        const written = new Promise<void>( ( resolve, reject ) => {
            output.on( 'finish', resolve );
            output.on( 'error', reject );
        } );

        cp.stdout.pipe( output );

        const [ exitCode ] = await Promise.all( [ waitForProcess( cp ), written ] );

        if ( exitCode !== 0 ) {
            throw new Error( `ffmpeg (${ runner.name }) exited with code ${ exitCode }: ${ stderr.trim() }` );
        }
    }
}
