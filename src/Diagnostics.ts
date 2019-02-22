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

export class Diagnostics {
    protected logger : Logger;

    server : UnicastServer;

    levels : string[];

    minimumLevel ?: string;

    inspector : any = (v) => v;// eyes.inspector();

    constructor ( server : UnicastServer, minimumLevel : string = 'debug' ) {
        this.server = server;

        this.logger = new Logger( this.server.storage, 'logs/app-:YYYY-:MM-:DD.log' );

        this.levels = [ 'debug', 'info', 'warning', 'error', 'fatal' ];

        this.minimumLevel = minimumLevel;
    }
    
    stopwatch () : Stopwatch {
        return new Stopwatch();
    }

    service ( key : string ) : DiagnosticsService {
        return new DiagnosticsService( this, key );
    }

    register ( key : string, time : number | Stopwatch, data ?: any ) {
        if ( time instanceof Stopwatch ) {
            time = time.readMilliseconds();
        }

        this.logger.write( 'profile', {
            time, key, data
        } );
    }

    async measure<T> ( key : string, task : ( sw : Stopwatch ) => Promise<T>, data ?: any ) : Promise<T> {
        const stopwatch = new Stopwatch().resume();

        const result : T = await task( stopwatch );

        this.register( key, stopwatch.pause(), data );

        return result;
    }

    log ( key : string, level : string, message : string, data ?: object ) : void {
        const levelIndex = this.levels.indexOf( level );

        if ( this.minimumLevel && levelIndex >= this.levels.indexOf( this.minimumLevel ) ) {
            const color = [ chalk.white, chalk.cyan, chalk.orange, chalk.red, chalk.magenta ][ levelIndex ];

            console.log( color( `[${ level.toUpperCase() }]` ) + chalk.green( `[${ key }]` ), message, data ? chalk.grey( this.inspector( data ) ) : '' );
        }

        this.logger.write( 'log', {
            level, key, message: stripAnsi( message ), data
        } );
    }

    debug ( key : string, message : string, data ?: object ) : void {
        this.log( key, 'debug', message, data );
    }

    info ( key : string, message : string, data ?: object ) : void {
        this.log( key, 'info', message, data );
    }

    warning ( key : string, message : string, data ?: object ) : void {
        this.log( key, 'warning', message, data );
    }

    error ( key : string, message : string, data ?: object ) : void {
        this.log( key, 'error', message, data );
    }

    fatal ( key : string, message : string, data ?: object ) : void {
        this.log( key, 'fatal', message, data );
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

export class DiagnosticsService {
    diagnostics : Diagnostics;

    key : string;

    constructor ( diagnostics : Diagnostics, key : string ) {
        this.diagnostics = diagnostics;
        this.key = key;
    }
    
    register ( time : number | Stopwatch, data ?: any ) : void {
        this.diagnostics.register( this.key, time, data );
    }

    async measure<T> ( task : ( sw : Stopwatch ) => Promise<T>, data ?: any ) : Promise<T> {
        return this.diagnostics.measure<T>( this.key, task, data );
    }

    log ( level : string, message : string, data ?: object ) : void {
        this.diagnostics.log( this.key, level, message, data );
    }

    debug ( message : string, data ?: object ) : void {
        this.diagnostics.debug( this.key, message, data );
    }

    info ( message : string, data ?: object ) : void {
        this.diagnostics.info( this.key, message, data );
    }

    warning ( message : string, data ?: object ) : void {
        this.diagnostics.warning( this.key, message, data );
    }

    error ( message : string, data ?: object ) : void {
        this.diagnostics.error( this.key, message, data );
    }

    fatal ( message : string, data ?: object ) : void {
        this.diagnostics.fatal( this.key, message, data );
    }

    service ( name : string ) : DiagnosticsService {
        return this.diagnostics.service( this.key + '/' + name );
    }
}

export class Logger {
    pattern : string;

    patternFactory : Function;

    protected lastFile : string;
    
    stream : fs.WriteStream;

    constructor ( storage : Storage, pattern : string ) {
        this.pattern = storage.getPath( pattern );

        this.patternFactory = tpl( this.pattern );
    }

    async writeRaw ( data : object ) : Promise<void> {
        const now = new Date();

        const locals = { 
            D: format( now, 'D' ),
            DD: format( now, 'DD' ), 
            M: format( now, 'M' ), 
            MM: format( now, 'MM' ), 
            Y: format( now, 'Y' ), 
            YY: format( now, 'YY' ),
            YYYY: format( now, 'YYYY' )
        };

        const file = this.patternFactory( locals );
        
        if ( !this.lastFile || this.lastFile != file ) {
            if ( this.stream ) {
                this.stream.close();
            }

            await makeDir( path.dirname( file ) );

            this.stream = fs.createWriteStream( file, { flags: 'a', defaultEncoding: 'utf8' } );

            this.lastFile = file;
        }

        this.stream.write( JSON.stringify( data ) + '\n' );
    }

    async write ( type : string, data : any ) {
        const timestamp = new Date().toISOString();
        
        return this.writeRaw( { type, timestamp, data } );
    }
}