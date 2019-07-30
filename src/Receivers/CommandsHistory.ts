import * as fs from 'mz/fs';
import { MediaRecord, MediaKind } from '../MediaRecord';
import { UnicastServer } from '../UnicastServer';
import { Semaphore } from 'data-semaphore';
import { AsyncStream } from 'data-async-iterators';
import { fromStream } from 'data-async-iterators/streams';
import * as objectPath from 'object-path';

export interface Command {
    session: string;
    media: { kind: MediaKind, id: string, external: any };
    playtime: number;
    command: string;
    args: any[];
    executedAt: number;
}

export class CommandsHistory {
    protected server : UnicastServer;

    protected buffered : Command[] = [];

    protected timeout : any  = null;

    protected _file : string;

    protected lock : Semaphore = new Semaphore( 1 );

    // We make sure the file name is only defined when it is first acessed because during the constructor, the server name is not yet defined
    // Which means the file name would be wrong if we simply created it there
    protected get file () {
        if ( this._file == null ) {
            this._file = this.server.storage.getPath( `rc-history-${ this.server.name }.jsonl` );
        }

        return this._file;
    }

    public constructor ( server : UnicastServer ) {
        this.server = server;
    }

    public flushSave () {
        if ( this.timeout === null ) {
            this.timeout = setTimeout( async () => {
                this.timeout = null;

                const commands = this.buffered;

                this.buffered = [];

                await this.lock.acquire();

                try {
                    await fs.appendFile( this.file, commands.map( c => JSON.stringify( c ) ).join( '\n' ) + '\n', { encoding: 'utf-8' } );
                } finally {
                    this.lock.release();
                }
            }, 5000 );
        }
    }

    public add ( session : string, media : MediaRecord, playtime : number, command : string, args : any[] = [] ) {
        this.buffered.push( { 
            session: session, 
            media: { kind: media.kind, id: media.id, external: media.external },
            playtime: playtime,
            command: command,
            args: args,
            executedAt: Date.now()
        } );

        this.flushSave();
    }

    public readAll () : AsyncStream<Command> {
        const readStream = fromStream<string>( fs.createReadStream( this.file, 'utf8' ) );

        return new AsyncStream( readStream ).chunkByLines().map( line => JSON.parse( line ) );
    }

    public readSome ( predicate : ( command : Command ) => boolean | Promise<boolean> ) : AsyncStream<Command> {
        return this.readAll().filter( predicate );
    }

    public readKeyed ( key : string, value : string ) : AsyncStream<Command> {
        return this.readSome( command => objectPath.get( command, key ) == value );
    }
}