import * as fs from 'mz/fs';
import * as path from 'path';
import { spawn } from 'child_process'
import { Config } from "./Config";
import * as os from 'os';
import { UnicastServer } from './UnicastServer';
import * as parseTorrentName from 'parse-torrent-name';
import { MediaSources, PlayableMediaRecord } from './MediaRecord';
import { Readable } from 'stream';
import { SemaphorePool, Synchronized } from 'data-semaphore';
import { MediaBitDepth, MediaColorSpace, MediaKind, MediaMetadata, MediaMetadataAudio, MediaMetadataSubtitles, MediaMetadataVideo, MediaResolution, MediaSource } from './Database/Tables/AbstractMediaTable';
import * as equals from 'fast-deep-equal';
import { Logger, pp } from 'clui-logger';
import { FFmpegProcess } from './Transcoding/FFmpegDriver/FFmpegProcess';
import * as uid from 'uid';

export class MediaTools {
    public server : UnicastServer;

    private semaphoreFileProbes : SemaphorePool<string> = new SemaphorePool<string>( 1 );

    private semaphoreMediaProbes : SemaphorePool<string> = new SemaphorePool<string>( 1 );

    private _pixelFormats : PixelFormat[] | null = null;

    private _resolutions : {width: number, height: number, name: MediaResolution}[];

    public constructor ( server : UnicastServer ) {
        this.server = server;
        this._resolutions = [
            { width: 7680, height: 4320, name: '4320p' },
            { width: 3840, height: 2160, name: '2160p' },
            { width: 2560, height: 1440, name: '1440p' },
            { width: 1920, height: 1080, name: '1080p' },
            { width: 1280, height: 720, name: '720p' },
            { width: 854, height: 480, name: '480p' },
            { width: 640, height: 360, name: '360p' },
            { width: 426, height: 240, name: '240p' },
        ];
    }

    protected probeNormalizeTracks ( tracks : any[] ) : TrackMediaProbe[] {
        const noNan = <T>( value : T ) => {
            return typeof value === 'number' && isNaN( value )
                ? null
                : value;
        }
        const fps = ( str : string ) => {
            const [ a, b ] = str.split( '/' );

            if ( +b == 0 ) {
                return null;
            }

            return +a / +b;
        };

        const bool = ( v ) => {
            if ( v == null ) {
                return v;
            }

            return !!v;
        }

        for ( let track of tracks ) {
            if ( !track.tags ) {
                track.tags = {};
            }
        }

        return tracks.map<TrackMediaProbe>( track => ( {
            index: track.index,
            typeIndex: track.typeIndex,
            file: 0,
            type: track.codec_type,
            codec: track.codec_name,
            bitrate: noNan( +track.tags.BPS ),
            size: noNan( +track.tags.NUMBER_OF_BYTES ),
            frames: noNan( +track.tags.NUMBER_OF_FRAMES ),
            width: noNan( +track.width ),
            height: noNan( +track.height ),
            aspectRatio: track.display_aspect_ratio,
            framerate: noNan( fps( track.r_frame_rate ) ),
            sampleRate: noNan( +track.sample_rate ),
            colorSpace: track.color_space,
            colorTransfer: track.color_transfer,
            colorPrimaries: track.color_primaries,
            channels: noNan( +track.channels ),
            channelLayout: track.channel_layout,
            // Track each stream's duration as well
            duration: null,
            pixelFormat: track.pix_fmt,
            language: track.tags?.language,
            title: track.tags?.title,
            default: bool( track.disposition?.default ),
            original: bool( track.disposition?.original ),
            forced: bool( track.disposition?.forced ),
            hearingImpaired: bool( track.disposition?.hearing_impaired ),
        } ) );
    }

    protected probeNormalizeFormat ( format : any ) : FormatMediaProbe {
        return {
            name: format.format_name,
            startTime: +format.start_time,
            duration: +format.duration,
            size: +format.size,
            bitrate: +format.bit_rate
        };
    }

    protected probeNormalize ( metadata : any, track : string ) : MediaProbe {
        return {
            files: [ {
                id: track,
                index: 0,
                format: this.probeNormalizeFormat( metadata.format ),
                duration: +metadata.format.duration,
                tracks: this.probeNormalizeTracks( metadata.streams )
            } ],
            tracks: this.probeNormalizeTracks( metadata.streams )
        }
    }

    async probe ( track : string ) : Promise<MediaProbe> {
        const release = await this.semaphoreFileProbes.acquire( track );

        try {
            let probe = new FFProbe( this.server.config, track );

            let metadata = await probe.run();

            return this.probeNormalize( metadata, track );
        } finally {
            release();
        }
    }

    async probeMedia ( media : PlayableMediaRecord, readCache : boolean = true, writeCache : boolean = true ) : Promise<MediaProbe> {
        const release = await this.semaphoreMediaProbes.acquire( media.id );

        try {
            // We need to query to see if a probe already exists if:
            //   - `readCache` is true, because that means we want to use the cached value if possible
            //   - `readCache` is false and `writeCache` is true, because that means, even though we don't want to use the cached value,
            //     we still want to save the new updated value. And to know whether that means creating a new row, or updating an existing one,
            //     we need to know if the row for this media record already exists
            // When they are both false, we can simply skip the query, and save some performance
            let probe = readCache || writeCache
                ? await this.server.database.tables.probes.findOne( query => query.where( 'mediaId', media.id ) )
                : null;

            if ( probe == null || readCache == false ) {
                const track = media.sources[ 0 ].id;

                const rawMetadata = await new FFProbe( this.server.config, track ).run();

                const metadata = this.probeNormalize( rawMetadata, track );

                const now = new Date();

                probe = {
                    mediaId: media.id,
                    mediaKind: media.kind,
                    metadata: metadata,
                    raw: rawMetadata,
                    createdAt: now,
                    updatedAt: now,
                };

                if ( writeCache ) {
                    await this.server.database.tables.probes.create( probe );
                }
            }

            return probe.metadata;
        } finally {
            release();
        }
    }

    async hasProbeCached ( media : PlayableMediaRecord ) : Promise<boolean> {
        let probe = await this.server.database.tables.probes.findOne( query => query.where( 'mediaId', media.id ) );

        return probe != null;
    }

    async getMetadata ( media : PlayableMediaRecord, readCache : boolean = true, writeCache : boolean = true ) : Promise<MediaMetadata> {
        const probe = await this.probeMedia( media, readCache, writeCache );

        return await this.convertToMetadata( probe );
    }

    protected getDefaultTrack ( tracks : TrackMediaProbe[] ) : TrackMediaProbe | undefined {
        return tracks.find( t => t.default ) ??
               tracks.find( t => t.original ) ??
               tracks[ 0 ];
    }

    protected classifyResolution ( width : number, height : number ) : MediaResolution {
        const threshold = 0.9;

        let name: MediaResolution;

        for ( const resolution of this._resolutions ) {
            name = resolution.name;

            if ( width >= resolution.width * threshold || height >= resolution.height * threshold ) {
                break;
            }
        }

        return name;
    }

    protected classifyBitdepth ( pixelFormatName : string | null ) : MediaBitDepth | null {
        if ( pixelFormatName == null ) {
            return null;
        }

        if ( this._pixelFormats == null ) {
            return null;
        }

        const pixelFormat = this._pixelFormats.find( fmt => fmt.name === pixelFormatName );

        if ( pixelFormat == null || pixelFormat.bitDepths.length === 0 ) {
            return null;
        }

        const max = Math.max(...pixelFormat.bitDepths);

        if ( max >= 10 ) {
            return '10bit';
        } else {
            return '8bit';
        }
    }

    protected classifyColorspace ( colorspace : string, colorPrimaries : string, colorTransfer : string ) : MediaColorSpace {
        if ( colorspace === "bt2020nc" && colorTransfer === "smpte2084" && colorPrimaries === "bt2020" ) {
            return 'HDR';
        } else {
            return 'SDR';
        }
    }

    protected convertVideoTrackToMetadata ( track : TrackMediaProbe ) : MediaMetadataVideo {
        const resolution = this.classifyResolution( track.width, track.height );

        const bitdepth = this.classifyBitdepth( track.pixelFormat );

        const codec = track.codec;

        const colorspace = this.classifyColorspace( track.colorSpace, track.colorPrimaries, track.colorTransfer );

        const framerate = track.framerate;

        return {
            resolution,
            bitdepth,
            codec,
            colorspace,
            framerate,
        };
    }

    protected classifyChannels ( channelsLayout : string | null ) : string | null {
        if ( channelsLayout == null ) {
            return null;
        }

        return channelsLayout.split( '(' )
            // Capitalize first letters
            .map( s => s[0].toUpperCase() + s.substring( 1 ) )
            .join( ' (' );
    }

    protected convertAudioTrackToMetadata ( track : TrackMediaProbe ) : MediaMetadataAudio {
        const bitrate = track.bitrate;

        const channels = this.classifyChannels( track.channelLayout );

        const codec = track.codec;

        const language = track.language;

        return {
            bitrate,
            channels,
            codec,
            language
        };
    }

    protected convertSubtitlesTrackToMetadata ( track : TrackMediaProbe ) : MediaMetadataSubtitles {
        const codec = track.codec;

        const language = track.language;

        const forced = track.forced;

        const hearingImpaired = track.hearingImpaired;

        return {
            codec,
            language,
            forced,
            hearingImpaired,
        };
    }

    async convertToMetadata ( probe : MediaProbe ) : Promise<MediaMetadata> {
        if ( this._pixelFormats == null ) {
            this._pixelFormats = await this.getCachedPixelFormats();
        }

        const videoTracks = probe.tracks.filter( t => t.type === 'video' );
        const audioTracks = probe.tracks.filter( t => t.type === 'audio' );
        const subtitlesTracks = probe.tracks.filter( t => t.type === 'subtitle' );

        const defaultVideoTrack = this.getDefaultTrack( videoTracks );
        const defaultAudioTrack = this.getDefaultTrack( audioTracks );
        const defaultSubtitlesTrack = this.getDefaultTrack( subtitlesTracks );

        const additionalVideoTracks = videoTracks.filter( t => t.index != defaultVideoTrack?.index );
        const additionalAudioTracks = audioTracks.filter( t => t.index != defaultAudioTrack?.index );
        const additionalSubtitlesTracks = subtitlesTracks.filter( t => t.index != defaultSubtitlesTrack?.index );

        const video = this.convertVideoTrackToMetadata( defaultVideoTrack );
        const audio = defaultAudioTrack != null ? this.convertAudioTrackToMetadata( defaultAudioTrack ) : null;
        const subtitles = defaultSubtitlesTrack != null ? this.convertSubtitlesTrackToMetadata( defaultSubtitlesTrack ) : null;

        const additionalVideo = additionalVideoTracks.map( t => this.convertVideoTrackToMetadata( t ) );
        const additionalAudio = additionalAudioTracks.map( t => this.convertAudioTrackToMetadata( t ) );
        const additionalSubtitles = additionalSubtitlesTracks.map( t => this.convertSubtitlesTrackToMetadata( t ) );

        const quality = MediaTools.parseDirAndBaseName( probe.files[ 0 ].id );

        return {
            // Video streams
            video, additionalVideo,
            // Audio Streams
            audio, additionalAudio,
            // Subtitle Streams
            subtitles, additionalSubtitles,

            duration: probe.files[0].duration,
            bitrate: probe.files[0].format.bitrate,
            size: probe.files[0].format.size,
            source: quality.source,
        };
    }

    getCommandPath ( command : string = 'ffmpeg' ) {
        const customPath = this.server.config.get( 'ffmpeg.path' );

        if ( customPath ) {
            if ( os.platform() == 'win32' ) {
                return path.join( customPath, command + '.exe' );
            } else {
                return path.join( customPath, command );
            }
        }

        return command;
    }

    static parseName ( names: string | Iterable<string> ): Partial<ParsedName> {
        if ( typeof names == 'string' ) {
            names = [ names ];
        }

        const globalDetails = {};

        for ( const name of names ) {
            const details = parseTorrentName( name ) ?? {};

            details.source = MediaSources.normalize( details.quality );

            if ( details.source == null ) {
                details.source = MediaSources.findAny( name, true );
            }

            for ( const key of Object.keys( details ) ) {
                if ( globalDetails[ key ] == null ) {
                    globalDetails[ key ] = details[ key ];
                }
            }
        }

        return globalDetails;
    }

    static parseBaseName ( filePath : string ) {
        return MediaTools.parseName( path.basename( filePath, path.extname( filePath ) ) );
    }

    static parseDirName ( filePath: string ) {
        return MediaTools.parseName( path.basename( path.dirname( filePath ) ) );
    }

    static parseDirAndBaseName ( filePath: string ) {
        const segments = [
            path.basename( filePath, path.extname( filePath ) )
        ];

        const dirname = path.basename( path.dirname( filePath ) );

        if ( dirname != null && dirname != '' && dirname != '.' && dirname != '..' ) {
            segments.push( dirname );
        }

        return MediaTools.parseName( segments );
    }

    static parsePath ( path : string, mode : ParsePathMode ) {
        if ( mode == ParsePathMode.Both ) {
            return MediaTools.parseDirAndBaseName( path );
        } else if ( mode == ParsePathMode.BaseName ) {
            return MediaTools.parseBaseName( path );
        } else if ( mode == ParsePathMode.DirName ) {
            return MediaTools.parseDirName( path );
        }
    }

    static streamToBuffer ( readable : Readable ) : Promise<Buffer> {
        return new Promise<Buffer>( ( resolve, reject ) => {
            const buffers: Buffer[] = [];
            readable.on( 'data', bf => buffers.push( bf ) );
            // TODO Fix typing, remove "as any"
            readable.on( 'end', () => resolve( Buffer.concat( buffers as any ) ) );
            readable.on( 'error', err => reject( err ) );
        } );
    }

    static async streamToString ( readable : Readable, encoding ?: BufferEncoding ) : Promise<string> {
        const buffer = await this.streamToBuffer( readable );

        return buffer.toString( encoding );
    }

    protected getFfmpegStringOutput ( args : string[] ): Promise<string> {
        const command = spawn( this.getCommandPath(), args );

        return MediaTools.streamToString( command.stdout );
    }

    /**
     * Parses the information returned by funning `ffmpeg -pix_fmts`
     *
     * Expects the output of the command to be like:
     *
     *      Pixel formats:
     *      I.... = Supported Input  format for conversion
     *      .O... = Supported Output format for conversion
     *      ..H.. = Hardware accelerated format
     *      ...P. = Paletted format
     *      ....B = Bitstream format
     *      FLAGS NAME            NB_COMPONENTS BITS_PER_PIXEL BIT_DEPTHS
     *      -----
     *      IO... yuv420p                3             12      8-8-8
     *      IO... yuyv422                3             16      8-8-8
     *      ...
     *
     * It deduces the indexes of the values, by looking at the column headers.
     */
    async getPixelFormats (): Promise<PixelFormat[]> {
        const output: string = await this.getFfmpegStringOutput( [ '-pix_fmts' ] );

        // Utility functions
        const locateColumn = ( line : string, header : string ) => {
            // Index position where the column starts
            const start = line.indexOf( header );

            if ( start < 0 ) throw new Error( `FFMpeg GetPixelFormats: Cannot find column '${header}' in table with columns '${line}'` );

            // Index position where the column ends (not included in the column)
            let end;
            for (end = start + header.length + 1; end < line.length; end++ ) {
                if (line[end] != ' ' && line[end] != '\t') break;
            }

            return { start: start, end: end };
        };

        const stringReader = ( str : string ) => {
            return new class StringReader {
                source : string;
                cursor : number = 0;

                constructor ( source : string ) {
                    this.source = source;
                }

                readLine () : string | null {
                    const len = this.source.length;

                    if ( this.cursor >= len ) {
                        return null;
                    }

                    let newLineChars = 1;
                    let foundNewLine = false;
                    let lineEndPos;
                    for ( lineEndPos = this.cursor; !foundNewLine && lineEndPos < len; lineEndPos++ ) {
                        // Handle LF line endings
                        if (this.source[lineEndPos] == '\n') {
                            foundNewLine = true;
                        } else if (this.source[lineEndPos] == '\r') {
                            // Handle CRLF line endings
                            if (lineEndPos + 1 < len && this.source[lineEndPos + 1] == '\n') {
                                lineEndPos += 1;
                                newLineChars += 1;
                            }

                            foundNewLine = true;
                        }
                    }

                    const line = this.source.substring( this.cursor, lineEndPos - newLineChars );

                    this.cursor = lineEndPos;

                    return line;
                }

                skipLines ( lineCount : number ) : number {
                    let count;

                    for (count = 0; count < lineCount; count++) {
                        const line = this.readLine();

                        if (line == null) {
                            break;
                        }
                    }

                    return count;
                }
            }( str );
        };

        const reader = stringReader( output );

        // Skip the initial lines containing information about the flags
        reader.skipLines(6);

        const header = reader.readLine();

        if ( header == null ) {
            throw new Error( `FFMpeg GetPixelFormats: Expected line with headers, got end of file.` );
        }

        // Column Positions
        const FLAGS = locateColumn( header, "FLAGS" );
        const NAME = locateColumn( header, "NAME" );
        const NB_COMPONENTS = locateColumn( header, "NB_COMPONENTS" );
        const BITS_PER_PIXEL = locateColumn( header, "BITS_PER_PIXEL" );
        const BIT_DEPTHS = locateColumn( header, "BIT_DEPTHS" );

        const headerSeparatorLine = reader.readLine();

        // Sanity check to see if the format matches
        if ( headerSeparatorLine != '-----' ) {
            throw new Error( `FFMpeg GetPixelFormats: Expected line after headers to be '-----', got '${ headerSeparatorLine }' instead.` );
        }

        // Array with format results
        const pixelFormats: PixelFormat[] = [];

        let formatLine: string | null;
        while ( ( formatLine = reader.readLine() ) != null ) {
            // Ignore empty lines
            if ( formatLine.length === 0 ) {
                continue;
            }

            // Read the column values based on the header indices
            const flagsValue = formatLine.substring( FLAGS.start, FLAGS.end ).trim();
            const nameValue = formatLine.substring( NAME.start, NAME.end ).trim();
            const nbComponentsValue = formatLine.substring( NB_COMPONENTS.start, NB_COMPONENTS.end ).trim();
            const bitsPerPixelValue = formatLine.substring( BITS_PER_PIXEL.start, BITS_PER_PIXEL.end ).trim();
            const bitDepthsValue = formatLine.substring( BIT_DEPTHS.start, BIT_DEPTHS.end ).trim();

            const parsedPixelFormat: PixelFormat = {
                flags: PixelFormatFlag.None,
                name: nameValue,
                numberComponents: parseInt( nbComponentsValue ),
                bitsPerPixel: parseInt( bitsPerPixelValue ),
                bitDepths: bitDepthsValue.split( '-' ).map( n => parseInt( n ) ),
            };

            if ( flagsValue[0] == 'I' ) parsedPixelFormat.flags |= PixelFormatFlag.Input;
            if ( flagsValue[1] == 'O' ) parsedPixelFormat.flags |= PixelFormatFlag.Output;
            if ( flagsValue[2] == 'H' ) parsedPixelFormat.flags |= PixelFormatFlag.HardwareAccelarated;
            if ( flagsValue[3] == 'P' ) parsedPixelFormat.flags |= PixelFormatFlag.Paletted;
            if ( flagsValue[4] == 'B' ) parsedPixelFormat.flags |= PixelFormatFlag.Bitstream;

            pixelFormats.push( parsedPixelFormat );
        }

        return pixelFormats;
    }

    @Synchronized()
    async getCachedPixelFormats () : Promise<PixelFormat[]> {
        return await this.server.dataStore.getOrStore(
            'mediaTools.pixelFormats',
            () => this.getPixelFormats()
        );
    }

    async getRemuxJob ( media : PlayableMediaRecord ) : Promise<RemuxJob> {
        const jobRecord = await this.server.dataStore.get( `mediaTools.remuxes.${media.kind}.${media.id}`);

        return jobRecord?.value;
    }

    async remux( media : PlayableMediaRecord, streams : TrackMediaProbe[], dryRun : boolean = false ) : Promise<void> {
        const remux = new Remuxer( this.server, media, streams, dryRun );

        await remux.run();
    }
}

export enum PixelFormatFlag {
    None = 0,
    Input = 1 << 0,
    Output = 1 << 1,
    HardwareAccelarated = 1 << 2,
    Paletted = 1 << 3,
    Bitstream = 1 << 4,
}

export interface PixelFormat {
    flags: PixelFormatFlag;
    name: string;
    numberComponents: number;
    bitsPerPixel: number;
    bitDepths: number[];
}

export enum ParsePathMode {
    BaseName,
    DirName,
    Both
}

export interface ParsedName {
    codec: string;
    group: string;
    resolution: string;
    quality: string;
    source: MediaSource | null;
    season : number;
    episode : number;
}

export interface TrackMediaProbe {
    index: number;
    typeIndex: number;
    file: number;
    type: 'video' | 'audio' | 'subtitle' | string;
    codec: string;
    bitrate: number;
    size: number;
    frames: number;
    width: number;
    height: number;
    aspectRatio: string;
    framerate: number;
    sampleRate: number;
    colorSpace?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    channels: number;
    channelLayout: string;
    duration: number;
    pixelFormat?: string;
    language?: string;
    title?: string;
    original?: boolean;
    default?: boolean;
    forced?: boolean;
    hearingImpaired?: boolean;
}

export interface FormatMediaProbe {
    name : string;
    startTime : number;
    duration : number;
    size : number;
    bitrate : number;
}

export interface FileMediaProbe {
    id : string;
    index : number;
    duration : number;
    format : FormatMediaProbe;
    tracks : TrackMediaProbe[];
}

export interface MediaProbe {
    files : FileMediaProbe[];
    tracks : TrackMediaProbe[];
}

export function binaryExecutableName ( name : string ) : string {
    if ( os.platform() == 'win32' ) {
        return name + '.exe';
    } else {
        return name;
    }
}

export class FFProbe {
    file : string;

    commandPath : string = 'ffprobe';

    args : string[] = [];

    constructor ( config : Config, file : string, options : any = {} ) {
        this.file = file;

        if ( config.has( 'ffmpeg.path' ) ) {
            this.commandPath = path.join( config.get( 'ffmpeg.path' ), binaryExecutableName( 'ffprobe' ) );
        } else {
            this.commandPath = binaryExecutableName( 'ffprobe' );
        }

        this.args  = [ '-show_format', '-show_streams', '-loglevel', 'warning', '-print_format', 'json' ];

        if ( typeof file === 'string' ) {
            this.args.push( '-i', file );
        } else {
            this.args.push( '-i', 'pipe:0' );
        }
    }

    transformResult ( result ) {
        result = JSON.parse( result );

        let types = {};

        result.streams = result.streams?.map( stream => {
            let type = stream.codec_type;

            if ( !( type in types ) ) {
                types[ type ] = 0;
            }

            stream.typeIndex = types[ type ]++;

            return stream;
        } ) ?? [];

        return result;
    }

    run ( ...args ) {
        return new Promise( ( resolve, reject ) => {
            try {
                let node = spawn( path.basename( this.commandPath ), this.args, {
                    cwd: path.dirname( this.commandPath )
                } );

                node.stdout.setEncoding( 'utf8' );
                node.stderr.setEncoding( 'utf8' );

                let exitCode;
                let result = '';
                let resultErr = '';

                node.stdout.on( 'data', data => result += typeof data == 'string' ? data : data.toString( 'utf8' ) );
                node.stderr.on( 'data', data => resultErr += data );
                node.stdout.on( 'end', () => {
                    try {
                        if ( exitCode || !result ) {
                            return reject( resultErr );
                        }

                        const parsedResult = this.transformResult( result );

                        if ( parsedResult == null || !( 'format' in parsedResult ) ) {
                            throw reject( resultErr );
                        }

                        return resolve( parsedResult );
                    } catch (err) {
                        return reject( err );
                    }
                } );

                node.on( 'exit', code => exitCode = code );
                node.on( 'error', err => reject( err ) );
            } catch ( error ) {
                reject( error );
            }
        } );
    }
}

export class Remuxer {
    public readonly server : UnicastServer;

    public readonly media : PlayableMediaRecord;

    public readonly streams : TrackMediaProbe[];

    public readonly dryRun : boolean;

    public readonly logger : Logger;

    /** == HEARTBEAT SYSTEM ==
     * While a remux job is running, a timer is running in the background every
     * `HEARTBEAT_INTERVAL` updating the last heartbeat timestamp.
     *
     * If the last heartbeat has been more than `HEARTBEAT_MAX_INTERVAL` ago,
     * the job will be considered to be dead.
     *
     * Of note, every update of the job also counts as an implicit heartbeat,
     * meaning, if the Job was updated less than `HEARTBEAT_MIN_INTERVAL` ago,
     * there is no need for the explicit heartbeat to update it again. Instead,
     * this heartbeat is skipped and the next one is scheduled as usual.
     */

    /* Interval in milliseconds, where the job is touched */
    protected readonly HEARTBEAT_INTERVAL = 15 * 1000;

    /* Minimum span of time, in milliseconds, between heartbeats. */
    protected readonly HEARTBEAT_MIN_INTERVAL = 10 * 1000;

    /* Maximum span of time, in milliseconds, to consider a job dead. */
    protected readonly HEARTBEAT_MAX_INTERVAL = 60 * 1000;

    /* Minimum interval, in milliseconds, between progress updates. */
    protected readonly PROGRESS_MIN_INTERVAL = 500;

    protected heartbeatTimer : NodeJS.Timeout | null = null;

    protected status : RemuxJob | null = null;

    protected sourceFilePath : string | null = null;

    protected temporaryFilePath : string | null = null;

    protected folder : string | null = null;

    protected basename : string | null = null;

    protected ext : string | null = null;

    public constructor ( server : UnicastServer, media : PlayableMediaRecord, streams : TrackMediaProbe[], dryRun : boolean ) {
        this.server = server;
        this.media = media;
        this.streams = streams;
        this.dryRun = dryRun;
        this.logger = this.server.logger.service( 'remuxer' );
    }

    protected startHeartbeat() {
        // If there is already a heartbeat running, do nothing
        if (this.heartbeatTimer != null) {
            return;
        }

        const tick = () => {
            this.heartbeatTimer = setTimeout(async () => {
                // Only start heart-beating when the job status has been initially
                // registered on the DB
                if ( this.status != null ) {
                    await this.updateJob({});
                }

                // Make sure the heartbeat was not cancelled while we were updating the database
                if (this.heartbeatTimer != null) {
                    tick();
                }
            }, this.HEARTBEAT_INTERVAL);
        };

        tick();
    }

    protected stopHeartbeat() {
        if (this.heartbeatTimer == null) {
            clearTimeout(this.heartbeatTimer);

            this.heartbeatTimer = null;
        }
    }

    @Synchronized()
    protected async updateJob(update : Partial<RemuxJob>) {
        if (this.status == null) {
            throw new Error(`Could not update remux job status, because status was not initialized for the first time.`);
        }

        const now = Date.now();

        this.status = {
            ...this.status!,
            ...update,
            lastHeartbeat: now,
            nextHeartbeat: now + this.HEARTBEAT_MAX_INTERVAL,
        };

        await this.server.dataStore.store(`mediaTools.remuxes.${this.media.kind}.${this.media.id}`, this.status);
    }

    protected async failJob(err : Error) {
        const errorMessage = err?.message ?? err?.toString() ?? '<undefined>';

        await this.updateJob({ errorMessage });
    }

    protected async stageQueue() {
        this.status = {
            mediaId: this.media.id,
            mediaKind: this.media.kind,
            streams: this.streams,
            stage: RemuxJobStage.Queued,
            stageProgress: 0,
            nextHeartbeat: Date.now() + this.HEARTBEAT_MAX_INTERVAL,
            lastHeartbeat: null,
        };

        await this.updateJob({});
    }

    protected async stagePreChecks() {
        await this.updateJob({
            stage: RemuxJobStage.PreChecks,
            stageProgress: 0,
        });

        const filePath = this.media.sources?.[ 0 ]?.id;

        if ( filePath == null ) {
            throw new Error(`Could not find a file path in the sources object.`);
        }

        if ( !await fs.access( filePath ).then( () => true, () => false ) ) {
            throw new Error( `File path ${filePath} is not accessible.` );
        }

        const latestProbe = await this.server.mediaTools.probe( filePath );

        const cachedProbe = await this.server.media.getTable( this.media.kind ).relations.probe.load( this.media );

        const removeUndefineds = <T>( obj : T ) => {
            if ( typeof obj !== 'object' || obj == null ) {
                return obj;
            }

            obj = {...obj};

            for ( const key of Object.keys( obj ) ) {
                if ( obj[ key ] === void 0 ) {
                    delete obj[ key ];
                }
            }

            return obj;
        }

        if ( cachedProbe == null || !equals( latestProbe.tracks.map( removeUndefineds ), cachedProbe.metadata.tracks ) ) {
            console.log(latestProbe.tracks.map( removeUndefineds ), cachedProbe.metadata.tracks);
            throw new Error( `Cached probe does not match actual probe. The file might have changed in the meantime. Please refresh the cached probe and try again, to avoid errors.` );
        }

        this.sourceFilePath = filePath;

        this.folder = path.dirname( this.sourceFilePath );

        if ( !await fs.access( this.folder ).then( () => true, () => false ) ) {
            throw new Error( `Folder ${this.folder} is not accessible.` );
        }

        this.ext = path.extname( this.sourceFilePath );
        this.basename = path.basename( this.sourceFilePath, this.ext );

        const temporaryFilePath = path.join( this.folder, this.basename + ".REMUX." + uid() + this.ext );

        // This one is the opposite, fails if the file already exists instead of if it doesn't
        if ( await fs.access( temporaryFilePath ).then( () => true, () => false ) ) {
            throw new Error( `Temporary file ${temporaryFilePath} already exists.` );
        }

        this.temporaryFilePath = temporaryFilePath;

        await this.updateJob({
            stageProgress: 100,
        });
    }

    protected async stageRunning() {
        await this.updateJob( {
            stage: RemuxJobStage.Running,
            stageProgress: 0,
        } );

        const args: string[] = [
            '-i', this.sourceFilePath
        ];

        if ( this.streams.some( stream => stream.type === 'video' ) ) {
            args.push( '-c:v', 'copy' );
        }

        if ( this.streams.some( stream => stream.type === 'audio' ) ) {
            args.push( '-c:a', 'copy' );
        }

        let index = 0;
        for ( const stream of this.streams ) {
            // Map the stream, where the '0' on the left is the index of the file
            // (when remuxing, we are dealing only with one file), and on the right
            // is the index of the stream to map
            args.push( '-map', '0:' + stream.index );

            const dispositions = [
                (stream.original ? '+' : '-' ) + 'original',
                (stream.default ? '+' : '-' ) + 'default',
                (stream.forced ? '+' : '-' ) + 'forced',
                (stream.hearingImpaired ? '+' : '-' ) + 'hearing_impaired',
            ].join( '' );

            args.push( '-disposition:' + index, dispositions );
            index += 1;
        }

        // Enable progress information to be parsed by the FFmpegProcess class below
        args.push( '-loglevel', 'error' );
        args.push( '-stats' );

        // Finally, push the output file name
        args.push( this.temporaryFilePath );

        if ( this.dryRun ) {
            this.logger.info(pp!`Dry running command "ffmpeg ${ args.join( ' ' ) }"`);
            return;
        }

        this.logger.info(pp!`Running command "ffmpeg ${ args.join( ' ' ) }"`);

        const process = new FFmpegProcess( this.server.mediaTools.getCommandPath(), args );

        let lastProgressTime : number | null = null;

        process.onProgress.subscribe( async progress => {
            const now = Date.now();

            if ( lastProgressTime == null || lastProgressTime + this.PROGRESS_MIN_INTERVAL <= now ) {
                lastProgressTime = now;

                this.logger.info("time " + progress.time.toHumanString());
                this.logger.info("duration " + progress.duration.toHumanString());
                this.logger.info("progress " + progress.percentage);
                await this.updateJob( {
                    stageProgress: progress.percentage
                } );
            }
        } );

        const duration = Math.max(0, ...this.streams.map(s => s.duration).filter( d => d != null && d > 0 ) );

        process.run( duration );

        await process.wait();

        await this.updateJob( {
            stage: RemuxJobStage.Running,
            stageProgress: 100,
        } );
    }

    protected async stagePostChecks() {
        await this.updateJob( {
            stage: RemuxJobStage.PostChecks,
            stageProgress: 0,
        } );

        const outputProbe = await this.server.mediaTools.probe( this.temporaryFilePath );

        if ( outputProbe.tracks.length != this.streams.length ) {
            throw new Error(`Wrong number of streams on output file: got ${outputProbe.tracks.length}, expected ${this.streams.length}`);
        }

        for ( let i = 0; i < this.streams.length; i++ ) {
            const outputStream = outputProbe.tracks[i];
            const expectedStream = this.streams[i];

            if ( outputStream.type != expectedStream.type ) {
                throw new Error(`Wrong stream index ${i + 1} property "type": got ${outputStream.type}, expected ${expectedStream.type}`);
            }

            if ( outputStream.language != expectedStream.language ) {
                throw new Error(`Wrong stream index ${i + 1} property "language": got ${outputStream.language}, expected ${expectedStream.language}`);
            }

            if ( outputStream.title != expectedStream.title ) {
                throw new Error(`Wrong stream index ${i + 1} property "title": got ${outputStream.title}, expected ${expectedStream.title}`);
            }

            if ( outputStream.original != expectedStream.original ) {
                throw new Error(`Wrong stream index ${i + 1} property "original": got ${outputStream.original}, expected ${expectedStream.original}`);
            }

            if ( outputStream.default != expectedStream.default ) {
                throw new Error(`Wrong stream index ${i + 1} property "default": got ${outputStream.default}, expected ${expectedStream.default}`);
            }

            if ( outputStream.forced != expectedStream.forced ) {
                throw new Error(`Wrong stream index ${i + 1} property "forced": got ${outputStream.forced}, expected ${expectedStream.forced}`);
            }

            if ( outputStream.hearingImpaired != expectedStream.hearingImpaired ) {
                throw new Error(`Wrong stream index ${i + 1} property "hearingImpaired": got ${outputStream.hearingImpaired}, expected ${expectedStream.hearingImpaired}`);
            }
        }

        await this.updateJob( {
            stage: RemuxJobStage.PostChecks,
            stageProgress: 100,
        } );

        return outputProbe;
    }

    protected async stageRenaming() {
        await this.updateJob( {
            stage: RemuxJobStage.Renaming,
            stageProgress: 0,
        } );

        const newSourceFileName = path.join( this.folder, this.basename + ".ORIGINAL." + uid() + this.ext );

        await fs.rename( this.sourceFilePath, newSourceFileName );

        await fs.rename( this.temporaryFilePath, this.sourceFilePath );

        await this.updateJob( {
            stage: RemuxJobStage.Renaming,
            stageProgress: 100,
        } );
    }

    protected async stageUpdateMetadata() {
        await this.updateJob( {
            stage: RemuxJobStage.UpdateMetadata,
            stageProgress: 0,
        } );

        await this.server.media.probe( this.media,
            /* readCache: */ false,
            /* writeCache: */ true,
            /* updateMetadata: */ true );

        await this.updateJob( {
            stage: RemuxJobStage.UpdateMetadata,
            stageProgress: 100,
        } );
    }

    protected async stageFinished() {
        await this.updateJob({
            stage: RemuxJobStage.Finished,
            stageProgress: 100
        });
    }

    public async run() : Promise<void> {
        this.startHeartbeat();

        try {
            await this.stageQueue();

            await this.stagePreChecks();

            if ( !this.dryRun ) {
                await this.stageRunning();

                await this.stagePostChecks();

                await this.stageRenaming();

                await this.stageUpdateMetadata();
            }

            await this.stageFinished();
        } catch (err) {
            // Do not await on purpose, register the failed job synchronously
            // with rethrowing the exception
            // noinspection ES6MissingAwait
            this.failJob(err);

            throw err;
        } finally {
            this.stopHeartbeat();
        }
    }
}

export interface RemuxJob {
    // Parameters
    mediaKind : MediaKind;
    mediaId : string;
    streams : TrackMediaProbe[];

    // Progress Info
    stage : RemuxJobStage;
    stageProgress : number;
    errorMessage ?: string;
    lastHeartbeat ?: number;
    nextHeartbeat : number;
}

export enum RemuxJobStage {
    Queued = 'queued',
    PreChecks = 'pre-checks',
    Running = 'running',
    PostChecks = 'post-checks',
    Renaming = 'renaming',
    UpdateMetadata = 'update-metadata',
    Finished = 'finished',
}
