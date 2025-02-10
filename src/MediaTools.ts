import * as path from 'path';
import { spawn } from 'child_process'
import { Config } from "./Config";
import * as os from 'os';
import { UnicastServer } from './UnicastServer';
import * as parseTorrentName from 'parse-torrent-name';
import { MediaSources, PlayableMediaRecord } from './MediaRecord';
import { Readable } from 'stream';
import { SemaphorePool, Synchronized, SynchronizedBy } from 'data-semaphore';
import { MediaBitDepth, MediaColorSpace, MediaMetadata, MediaMetadataAudio, MediaMetadataSubtitles, MediaMetadataVideo, MediaResolution, MediaSource } from './Database/Tables/AbstractMediaTable';

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
            bitrate: +track.tags.BPS,
            size: +track.tags.NUMBER_OF_BYTES,
            frames: +track.tags.NUMBER_OF_FRAMES,
            width: +track.width,
            height: +track.height,
            aspectRatio: track.display_aspect_ratio,
            framerate: fps( track.r_frame_rate ),
            sampleRate: +track.sample_rate,
            colorSpace: track.color_space,
            colorTransfer: track.color_transfer,
            colorPrimaries: track.color_primaries,
            channels: +track.channels,
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
    typeIndex: string;
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
