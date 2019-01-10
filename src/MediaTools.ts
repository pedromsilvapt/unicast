import * as path from 'path';
import { spawn } from 'child_process'
import { Config } from "./Config";
import * as os from 'os';
import { UnicastServer } from './UnicastServer';

export class MediaTools {
    protected static probeNormalizeTracks ( tracks : any[] ) : TrackMediaMetadata[] {
        const fps = ( str : string ) => {
            const [ a, b ] = str.split( '/' );

            if ( +b == 0 ) {
                return null;
            }

            return +a / +b;
        };

        for ( let track of tracks ) {
            if ( !track.tags ) {
                track.tags = {};
            }
        }

        return tracks.map<TrackMediaMetadata>( track => ( {
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
            // Track each stream's duration as well
            duration: null
        } ) );
    }

    protected static probeNormalizeFormat ( format : any ) : FormatMediaMetadata {
        return {
            name: format.format_name,
            startTime: +format.start_time,
            duration: +format.duration,
            size: +format.size,
            bitrate: +format.bit_rate
        };
    }

    protected static probeNormalize ( metadata : any, track : string ) : MediaMetadata {
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

    static async probe ( track : string ) : Promise<MediaMetadata> {
        let probe = new FFProbe( track );
        
        let metadata = await probe.run();

        return this.probeNormalize( metadata, track );
    }

    static getCommandPath ( server : UnicastServer, command : string = 'ffmpeg' ) {
        const customPath = server.config.get( 'ffmpeg.path' );

        if ( customPath ) {
            if ( os.platform() == 'win32' ) {
                return path.join( customPath, command + '.exe' );
            } else {
                return path.join( customPath, command );
            }
        }

        return command;
    }
}

export interface TrackMediaMetadata {
    index: number;
    typeIndex: string;
    file: number;
    type: string;
    codec: string;
    bitrate: number;
    size: number;
    frames: number;
    width: number;
    height: number;
    aspectRatio: string;
    framerate: number;
    duration: number;
}

export interface FormatMediaMetadata {
    name : string;
    startTime : number;
    duration : number;
    size : number;
    bitrate : number;
}

export interface FileMediaMetadata {
    id : string;
    index : number;
    duration : number;
    format : FormatMediaMetadata;
    tracks : TrackMediaMetadata[];
}

export interface MediaMetadata {
    files : FileMediaMetadata[];
    tracks : TrackMediaMetadata[];
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

    constructor ( file : string, options : any = {} ) {
        this.file = file;

        if ( Config.has( 'ffmpeg.path' ) ) {
            this.commandPath = path.join( Config.get( 'ffmpeg.path' ), binaryExecutableName( 'ffprobe' ) );
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

        result.streams = result.streams.map( stream => {
            let type = stream.codec_type;

            if ( !( type in types ) ) {
                types[ type ] = 0;
            }

            stream.typeIndex = types[ type ]++;

            return stream;
        } );

        return result;
    }

    run ( ...args ) {
        return new Promise( ( resolve, reject ) => {
            try {
                let node = spawn( path.basename( this.commandPath ), this.args, {
                    cwd: path.dirname( this.commandPath )
                } );
        
                node.stdout.setEncoding( 'utf8' );

                let exitCode;
                let result = '';
                let resultErr = '';

                node.stdout.on( 'data', data => result += typeof data == 'string' ? data : data.toString( 'utf8' ) );
                node.stderr.on( 'data', data => resultErr += data );
                node.stdout.on( 'end', () => {
                    if ( exitCode || !result ) {
                        return reject( resultErr );
                    }

                    resolve( this.transformResult( result ) );
                } );

                node.on( 'exit', code => exitCode = code );
                node.on( 'error', err => reject( err ) );
            } catch ( error ) {
                reject( error );
            }
        } );
    }
}