import { UnicastServer } from '../../../UnicastServer';
import * as path from 'path';
import { spawn } from 'mz/child_process';
import { Future } from '@pedromsilva/data-future';
import { EventEmitter } from "events";

export function fromEvent<T = any> ( emitter : EventEmitter, resolveName : string, rejectName : string = 'error' ) : Promise<T> {
    return new Promise<T>( ( resolve, reject ) => {
        emitter.on( resolveName, resolve );

        if ( rejectName ) {
            emitter.on( rejectName, reject );
        }
    } );
}

export class MpvPlayer {
    program : string;
    
    video : string;

    subtitles : string;

    script : string = null;

    args : string[];

    protected completedFuture : Future<void> = new Future();

    public static fromServer ( server : UnicastServer, video : string, subtitles ?: string ) : MpvPlayer {
        const program = path.join( server.config.get( 'mpv.path' ), server.config.get( 'mpv.command' ) );

        const args = server.config.get<string[]>( 'mpv.args', [] );

        return new MpvPlayer( program, video, subtitles, args );
    }

    constructor ( program : string, video : string, subtitles ?: string, args : string[] = [] ) {
        this.program = program;
        this.video = video;
        this.subtitles = subtitles;
        this.args = args;
    }

    public run () {
        const args = [ 
            '--fullscreen=yes',
            this.video,
            ...this.args
        ];

        if ( this.subtitles ) {
            args.push( `--sub-file=${ this.subtitles }` );
        }

        if ( this.script ) {
            args.push( `--script=${ this.script }` );
        }

        const process = spawn( this.program, args );

        fromEvent( process, 'exit', 'error' ).then( () => this.completedFuture.resolve(), err => this.completedFuture.reject( err ) );

        return this;
    }

    public wait () {
        return this.completedFuture.promise;
    }
}