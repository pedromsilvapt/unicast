import { Stopwatch } from "./BackgroundTask";
import { UnicastServer } from "./UnicastServer";
import { Storage } from "./Storage";
import * as pidusage from 'pidusage';
import * as makeDir from 'make-dir';
import * as fs from 'mz/fs';
import * as tpl from 'mnml-tpl';
import { format } from "date-fns";
import * as stripAnsi from 'strip-ansi';
import * as chalk from 'chalk';
import * as path from 'path';
import { ConsoleBackend, SharedLogger, Logger, MultiBackend, FileBackend } from 'clui-logger';

export async function measure <T> ( diagnostics : Logger, task : ( sw : Stopwatch ) => Promise<T>, data ?: any ) : Promise<T>;
export async function measure <T> ( diagnostics : SharedLogger, key : string, task : ( sw : Stopwatch ) => Promise<T>, data ?: any ) : Promise<T>;
export async function measure <T> ( diagnostics : SharedLogger | Logger, key : string | (( sw : Stopwatch ) => Promise<T>), task ?: ( sw : Stopwatch ) => Promise<T> | any, data ?: any ) : Promise<T> {
    if ( diagnostics instanceof Logger ) {
        data = task;
        task = key as any;
        key = null;
    }

    const stopwatch = new Stopwatch().resume();

    const result : T = await task( stopwatch );

    stopwatch.pause();
   
    if ( diagnostics instanceof SharedLogger ) {
        diagnostics.debug( key as string, `Action took ${ stopwatch.readHumanized() }`, {
            ...data || {},
            time: stopwatch.readMilliseconds()
        } );
    } else {
        diagnostics.debug( `Action took ${ stopwatch.readHumanized() }`, {
            ...data || {},
             time: stopwatch.readMilliseconds()
        } );
    }

    return result;
}

export class Diagnostics {
    public static createLogger ( server : UnicastServer ) : SharedLogger {
        const backend = new MultiBackend( [
            new ConsoleBackend(),
            new FileBackend( server.storage.getPath( 'logs/app-:YYYY-:MM-:DD.log' ) )
        ] );
        
        return new SharedLogger( backend );
    }

    server : UnicastServer;

    levels : string[];

    minimumLevel ?: string;

    constructor ( server : UnicastServer, minimumLevel : string = 'debug' ) {
        this.server = server;

        this.levels = [ 'debug', 'info', 'warning', 'error', 'fatal' ];

        this.minimumLevel = minimumLevel;
    }
    
    register ( key : string, time : number | Stopwatch, data ?: any ) {
        if ( time instanceof Stopwatch ) {
            time = time.readHumanized();
        }

        this.server.logger.debug( key, time.toString(), data );
    }

    async measure<T> ( key : string, task : ( sw : Stopwatch ) => Promise<T>, data ?: any ) : Promise<T> {
        const stopwatch = new Stopwatch().resume();

        const result : T = await task( stopwatch );

        this.register( key, stopwatch.pause(), data );

        return result;
    }

    async resources ( pid ?: number ) {
        if ( !pid ) {
            pid = process.pid;
        }

        return new Promise( ( resolve, reject ) => {
            pidusage.stat( process.pid, ( err, stat ) => {
                if ( err ) {
                    return reject( err );
                }

                resolve( {
                    own: pid == process.pid,
                    pid: pid,
                    cpu: stat.cpu,
                    memory: stat.memory
                } );
            } );
        } );
    }
}
