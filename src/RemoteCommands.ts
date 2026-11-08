import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Configuration that allows commands (such as ffmpeg) that operate on files
 * inside a network mount to be executed directly on the machine that hosts
 * those files, through SSH.
 */
export interface RemoteCommandConfig {
    /** Any ssh destination, including an alias from ~/.ssh/config */
    host : string;
    /**
     * Path on the remote machine that corresponds to the mount path.
     * When omitted, the paths are assumed to be the same on both machines.
     */
    mapping ?: string;
    /** Folder where the ffmpeg binaries live on the remote machine. When omitted, relies on the remote PATH */
    ffmpegPath ?: string;
}

export interface RemoteMount {
    path : string;
    remote ?: RemoteCommandConfig;
}

export interface SshOptions {
    connectTimeout ?: number;
    controlPersist ?: number;
    controlPath ?: string;
}

export interface CommandRunner {
    readonly name : string;

    readonly remote : boolean;

    /**
     * Converts a local file path into the path that the spawned command should receive
     */
    mapPath ( localPath : string ) : string;

    /**
     * Returns the path to the binary (ffmpeg, ffprobe, ...) to execute
     */
    getCommandPath ( command : string ) : string;

    spawn ( command : string, args : string[], options ?: SpawnOptions ) : ChildProcess;

    /**
     * Stops a process created by this runner
     */
    kill ( process : ChildProcess ) : void;
}

/**
 * Quotes a single argument for a POSIX shell
 */
export function shellQuote ( arg : string ) : string {
    return "'" + arg.replace( /'/g, `'\\''` ) + "'";
}

export function shellJoin ( command : string, args : string[] ) : string {
    return [ command, ...args ].map( shellQuote ).join( ' ' );
}

/**
 * Checks if the file is the prefix or is inside it, matching whole path components
 * (`/mnt/media2` is not under `/mnt/media`). Returns the remaining path segments, or null.
 */
export function underPrefix ( file : string, prefix : string ) : string[] | null {
    const rel = path.relative( path.resolve( prefix ), path.resolve( file ) );

    if ( rel === '..' || rel.startsWith( '..' + path.sep ) || path.isAbsolute( rel ) ) {
        return null;
    }

    return rel === '' ? [] : rel.split( /[\\/]+/g );
}

export class LocalRunner implements CommandRunner {
    readonly name : string = 'local';

    readonly remote : boolean = false;

    protected localCommandPath : ( command : string ) => string;

    constructor ( localCommandPath : ( command : string ) => string = command => command ) {
        this.localCommandPath = localCommandPath;
    }

    mapPath ( localPath : string ) : string {
        return localPath;
    }

    getCommandPath ( command : string ) : string {
        return this.localCommandPath( command );
    }

    spawn ( command : string, args : string[], options ?: SpawnOptions ) : ChildProcess {
        return spawn( command, args, options ?? {} );
    }

    kill ( process : ChildProcess ) : void {
        process.kill( 'SIGINT' );
    }
}

export class SshRunner implements CommandRunner {
    readonly remote : boolean = true;

    readonly mountPath : string;

    readonly config : RemoteCommandConfig;

    readonly options : SshOptions;

    constructor ( mountPath : string, config : RemoteCommandConfig, options : SshOptions = {} ) {
        this.mountPath = mountPath;
        this.config = config;
        this.options = options;
    }

    get name () : string {
        return this.config.host;
    }

    mapPath ( localPath : string ) : string {
        if ( !this.config.mapping ) {
            return localPath;
        }

        const rest = underPrefix( localPath, this.mountPath );

        if ( rest == null ) {
            return localPath;
        }

        return path.posix.join( this.config.mapping, ...rest );
    }

    getCommandPath ( command : string ) : string {
        if ( this.config.ffmpegPath ) {
            return path.posix.join( this.config.ffmpegPath, command );
        }

        return command;
    }

    protected getSshArgs () : string[] {
        const args = [ '-T', '-o', 'BatchMode=yes' ];

        args.push( '-o', `ConnectTimeout=${ this.options.connectTimeout ?? 10 }` );

        // Windows' OpenSSH does not support connection multiplexing
        if ( os.platform() !== 'win32' && ( this.options.controlPersist ?? 60 ) > 0 ) {
            const controlFolder = this.options.controlPath ?? path.join( os.tmpdir(), 'unicast-ssh' );

            try {
                fs.mkdirSync( controlFolder, { recursive: true, mode: 0o700 } );

                args.push(
                    '-o', 'ControlMaster=auto',
                    '-o', `ControlPath=${ path.join( controlFolder, '%C' ) }`,
                    '-o', `ControlPersist=${ this.options.controlPersist ?? 60 }`,
                );
            } catch { }
        }

        return args;
    }

    /**
     * Builds the script to run on the remote (POSIX) shell. ssh does not forward
     * signals to the remote process, so a watcher interrupts the command as
     * soon as the ssh session's stdin is closed (local kill, crash, or dropped connection).
     */
    protected getRemoteScript ( command : string, args : string[] ) : string {
        const script = `${ shellJoin( command, args ) } </dev/null & p=$!; `
             + `{ cat >/dev/null; kill -INT $p 2>/dev/null; } <&0 >/dev/null 2>&1 & w=$!; `
             + `wait $p; s=$?; kill $w 2>/dev/null; exit $s`;

        // The remote login shell may not be POSIX (fish, for instance), so the script is
        // base64 encoded: the resulting command only has characters every shell passes as-is
        const encoded = Buffer.from( script, 'utf8' ).toString( 'base64' );

        return `sh -c 'eval "$(printf %s ${ encoded } | base64 -d)"'`;
    }

    spawn ( command : string, args : string[], options ?: SpawnOptions ) : ChildProcess {
        const sshArgs = [ ...this.getSshArgs(), this.config.host, '--', this.getRemoteScript( command, args ) ];

        const stdio = options?.stdio;

        // The ssh stdin must always be a pipe, since closing it is what stops the remote process
        let normalizedStdio : SpawnOptions[ 'stdio' ];

        if ( stdio instanceof Array ) {
            normalizedStdio = [ 'pipe', ...stdio.slice( 1 ) ] as any;
        } else if ( typeof stdio === 'string' ) {
            normalizedStdio = [ 'pipe', stdio, stdio ] as any;
        } else {
            normalizedStdio = 'pipe';
        }

        return spawn( 'ssh', sshArgs, { ...( options ?? {} ), cwd: undefined, stdio: normalizedStdio } );
    }

    kill ( process : ChildProcess ) : void {
        // Closing stdin makes the remote watcher interrupt the command, and ssh exits on its own
        process.stdin?.end();

        const timeout = setTimeout( () => {
            if ( process.exitCode == null && process.signalCode == null ) {
                process.kill( 'SIGINT' );
            }
        }, 5000 );

        process.once( 'exit', () => clearTimeout( timeout ) );
    }
}

/**
 * Finds the mount (with the longest matching path) that contains the given file
 */
export function findRemoteMount<M extends RemoteMount> ( file : string, mounts : Iterable<M> ) : M | null {
    let best : M | null = null;
    let bestLength = -1;

    for ( const mount of mounts ) {
        if ( mount.remote == null || !mount.remote.host || !mount.path ) {
            continue;
        }

        if ( underPrefix( file, mount.path ) == null ) {
            continue;
        }

        const length = path.resolve( mount.path ).length;

        if ( length > bestLength ) {
            best = mount;
            bestLength = length;
        }
    }

    return best;
}
