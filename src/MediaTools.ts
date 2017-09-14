import * as path from 'path';
import { spawn } from 'child_process'
import { Config } from "./Config";

export class MediaTools {
    protected static probeNormalizeTracks ( tracks : any[] ) {
        return tracks.map( track => ( {
            index: track.index,
            typeIndex: track.typeIndex,
            file: 0,
            type: track.codec_type,
            codec: track.codec_name
        } ) );
    }

    protected static probeNormalize ( metadata : any, track : string ) : MediaMetadata {
        return {
            files: [ {
                id: track,
                index: 0,
                format: metadata.format.format_name,
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
}

export interface TrackMediaMetadata {
    index: number,
    typeIndex: string,
    file: number,
    type: string,
    codec: string
}

export interface FileMediaMetadata {
    id : string;
    index : number;
    format : string;
    duration : number;
    tracks : TrackMediaMetadata[];
}

export interface MediaMetadata {
    files : FileMediaMetadata[];
    tracks : TrackMediaMetadata[];
}

export class FFProbe {
    file : string;

    commandPath : string = 'ffprobe';

    args : string[] = [];

    constructor ( file : string, options : any = {} ) {
        this.file = file;

        if ( Config.has( 'ffmpeg.path' ) ) {
            this.commandPath = path.join( Config.get( 'ffmpeg.path' ), 'ffprobe' );
        } else {
            this.commandPath = 'ffprobe';
        }

        this.args  = [ '-show_format', '-show_streams', '-loglevel', 'warning', '-print_format', 'json' ];

        if ( typeof file === 'string' ) {
            this.args.push( '-i', file );
        } else {
            this.args.push( '-i', 'pipe:0' );
        }

        // options = extend( {
        //     showStreams: true,
        //     showFormat: true,
        //     logLevel: 'warning',
        //     format: 'json'
        // }, options );

        // this.setOptionMeta( [ 'show_format', 'show_streams' ], { toggle: true } );
        // this.setOptionMeta( 'format', { rename: 'of' } );
        // this.setOptionMeta( 'log_level', { rename: 'loglevel' } );

        // this.setManyOptions( options );
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

                node.stdout.on( 'data', data => result += data.toString( 'utf8' ) );
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