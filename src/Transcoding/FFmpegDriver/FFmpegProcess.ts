import { ChildProcess, spawn } from "child_process";
import { FFmpegProgress } from './FFmpegProgress';
import { Future } from '@pedromsilva/data-future';
import { Hook } from '../../Hookable';
import * as byline from 'byline';
import { Duration } from '../../ES2017/Units';

export enum FFmpegErrorDetector {
    VerboseError = 0,
    Fuzzy = 1,
    None = 2
}

export class FFmpegProcess {
    process : ChildProcess = null;

    args : string[];

    command : string;

    onProgress : Hook<FFmpegProgress> = new Hook( 'onProgress' );
    
    onOutputLine : Hook<string> = new Hook( 'onOutputLine' );

    killed : boolean = false;

    errorDetector : FFmpegErrorDetector = FFmpegErrorDetector.VerboseError;

    protected completedFuture : Future<void> = new Future();

    protected errorMessages : string[] = [];

    constructor ( command : string, args : string[] ) {
        this.command = command;
        this.args = args;
    }

    run ( duration ?: number | string | Duration ) {
        if ( this.killed || this.process != null ) {
            return this;
        }

        this.process = spawn( this.command, this.args );

        this.process.on( 'error', error => this.completedFuture.reject( error ) );
        
        const progress = new FFmpegProgress( duration );
        
        byline.createStream( this.process.stderr ).on( 'data', buffer => {
            const line : string = buffer.toString();
            
            this.onOutputLine.notify( line );

            if ( progress.update( line ) ) {
                this.onProgress.notify( progress );
            } else {
                if ( this.errorMessages.length < 20 ) {
                    let isError = false;
                    
                    if ( this.errorDetector === FFmpegErrorDetector.VerboseError ) {
                        isError = true;
                    } else if ( this.errorDetector === FFmpegErrorDetector.Fuzzy ) {
                        if ( line.includes( 'Error' ) || this.errorMessages.length > 0 ) {
                            isError = true;
                        }
                    }
    
                    if ( isError ) {
                        this.errorMessages.push( line );
                    }
                }
            }
        } );
        
        this.process.stderr.on( 'end', () => {
            if ( this.errorMessages.length > 0 ) {
                this.completedFuture.reject( new Error( `Encoding error: ` + this.errorMessages.join( '\n' ) ) );
            } else {
                this.completedFuture.resolve();
            }
        } );
    }

    pause () {
        if ( this.process ) {
            this.process.kill( 'SIGSTOP' );
        }
    }

    resume () {
        if ( this.process ) {
            this.process.kill( 'SIGCONT' );
        }
    }

    kill () {
        this.killed = true;

        if ( this.process ) {
            this.process.kill( 'SIGINT' );
        }
    }

    wait () {
        return this.completedFuture.promise;
    }
}