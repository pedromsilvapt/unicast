import { Stopwatch } from "./BackgroundTask";
import { UnicastServer } from "./UnicastServer";
import { Storage } from "./Storage";
import * as pidusage from 'pidusage';
import * as fs from 'mz/fs';
import * as tpl from 'mnml-tpl';
import { format } from "date-fns";

export class Diagnostics {
    protected logger : Logger;

    server : UnicastServer;

    levels : string[];

    minimumLevel ?: string;

    constructor ( server : UnicastServer, minimumLevel : string = 'info' ) {
        this.server = server;

        this.logger = new Logger( this.server.storage, 'logs/app-:YYYY-:MM-:DD.log' );

        this.levels = [ 'debug', 'info', 'warning', 'error', 'fatal' ];

        this.minimumLevel = minimumLevel;
    }
    
    stopwatch () : Stopwatch {
        return new Stopwatch();
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

    log ( level : string, message : string, data ?: object ) : void {
        if ( this.minimumLevel && this.levels.indexOf( level ) >= this.levels.indexOf( this.minimumLevel ) ) {
            console.log( `[${level.toUpperCase()}]`, message );
        }

        this.logger.write( 'log', {
            level, message, data
        } );
    }

    debug ( message : string, data ?: object ) : void {
        this.log( 'debug', message, data );
    }

    info ( message : string, data ?: object ) : void {
        this.log( 'info', message, data );
    }

    warning ( message : string, data ?: object ) : void {
        this.log( 'warning', message, data );
    }

    error ( message : string, data ?: object ) : void {
        this.log( 'error', message, data );
    }

    fatal ( message : string, data ?: object ) : void {
        this.log( 'fatal', message, data );
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