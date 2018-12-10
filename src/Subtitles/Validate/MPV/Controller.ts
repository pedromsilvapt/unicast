import { IVideoPlayerController } from "../IVideoPlayerController";
import { UnicastServer } from "../../../UnicastServer";
import * as fs from 'mz/fs';
import * as path from 'path';
import { spawn } from 'mz/child_process';
import * as parser from 'subtitles-parser';
import * as mess from 'mess';
import * as os from 'os';
import { EventEmitter } from "events";

export function fromEvent<T = any> ( emitter : EventEmitter, resolveName : string, rejectName : string = 'error' ) : Promise<T> {
    return new Promise<T>( ( resolve, reject ) => {
        emitter.on( resolveName, resolve );

        if ( rejectName ) {
            emitter.on( rejectName, reject );
        }
    } );
}

interface SubtitleLine {
    id : number;
    endTime : number;
    startTime : number;
}

interface SubtitleTimestamp {
    start : number;
    end : number;
}

const ControllerSource = fs.readFileSync( path.join( __dirname, 'Controller.txt.js' ), 'utf8' );

export class MpvController implements IVideoPlayerController {
    server : UnicastServer;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async getSubtitles ( subtitles : string ) {
        let contents = await fs.readFile( subtitles, 'utf8' );

        return parser.fromSrt( contents, true );
    }
    
    random ( low : number, high : number ) : number {
        return Math.random() * ( high - low + 1 ) + low;
    }

    getRandomLineIds ( lines : SubtitleLine[], container : { [ id : number ] : boolean }, count : number ) : void {
        count = Math.min( count, lines.length );

        let found = 0;

        while ( found < Math.min( count, lines.length ) ) {
            let random = this.random( 0, lines.length - 1 );

            if ( !lines[ random ] || container[ lines[ random ].id ] ) {
                continue;
            }

            container[ lines[ random ].id ] = true;

            found++;
        }
    }

    getRandomLines ( lines : SubtitleLine[], count : number = 5 ) : SubtitleLine[] {
        let ids = {};

        let long = lines.filter( line => line.endTime - line.startTime >= 3000 );

        this.getRandomLineIds( long, ids, Math.min( count, long.length ) );

        if ( long.length < count ) {
            let short = lines.filter( line => line.endTime - line.startTime < 3000 );

            this.getRandomLineIds( short, ids, count - long.length );
        }

        return mess( Array.from( lines.filter( line => line.id in ids ) ) );
    }

    getSectionedLines ( lines : SubtitleLine[], count : number = 5, offset : number = 10 ) : SubtitleLine[] {
        lines = lines.filter( line => line.endTime - line.startTime >= 3000 );

        let skippedCount = Math.floor( offset * lines.length / 100 );

        let size = lines.length - skippedCount * 2;

        count = Math.min( count, size );

        let result = [];

        for ( let i = 0; i < count; i++ ) {
            result.push( lines[ skippedCount + Math.floor( size / count * ( i + 1 ) ) ] );
        }

        return mess( result );
    }

    async getTimestamps ( subtitles : string ) : Promise<SubtitleTimestamp[]> {
        const lines = await this.getSubtitles( subtitles );

        return this.getSectionedLines( lines, 3 ).map( line => ( { start: line.startTime - 1000, end : line.endTime + 1000 } ) );
    }

    protected async run ( video : string, subtitles : string, controller : string ) {
        const program = path.join( this.server.config.get( 'mpv.path' ), this.server.config.get( 'mpv.command' ) );

        const args = [ 
            `--script=${ controller }`, 
            `--sub-file=${ subtitles }`,
            '--fullscreen=yes',
            video,
            ...this.server.config.get<string[]>( 'mpv.args', [] )
        ];

        const process = spawn( program, args );

        await fromEvent( process, 'exit', 'error' );
    }

    async play ( video : string, subtitles : string ) : Promise<void> {
        const timestamps : SubtitleTimestamp[] = await this.getTimestamps( subtitles );

        const source = ControllerSource.replace( /__timestamps__/, JSON.stringify( timestamps ) );

        const sourceFile = await this.server.storage.getRandomFile( 'mpv-controller-', 'js', 'temp/subtitles' );

        await fs.writeFile( sourceFile, source, 'utf8' );

        await this.run( video, subtitles, sourceFile );
    }
}