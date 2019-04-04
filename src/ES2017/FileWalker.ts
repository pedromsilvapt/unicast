import * as fs from 'mz/fs';
import * as path from 'path';
import { AsyncStream } from 'data-async-iterators';
import { LiveLogger } from 'clui-logger';

export class FileWalker {
    useAbsolutePaths : boolean = true;

    protected yieldFileRecord ( base : string, file : string, stats : fs.Stats ) : [ string, fs.Stats ] {
        if ( this.useAbsolutePaths ) {
            return [ file, stats ];
        } else {
            return [ path.relative( base, file ), stats ];
        }
    }

    protected isExcluded ( base : string, file : string, stats : fs.Stats ) : boolean | Promise<boolean> {
        return false;
    }
    
    protected async * runSingle ( base : string, file : string, stats ?: fs.Stats ) : AsyncIterableIterator<[ string, fs.Stats ]> {
        if ( !stats ) {
            stats = await fs.stat( file );
        }

        if ( stats.isFile() ) {
            if ( !await this.isExcluded( base, file, stats ) ) {
                yield this.yieldFileRecord( base, file, stats );
            }
        } else if ( stats.isDirectory() ) {
            const children = await fs.readdir( file );
            
            for ( let child of children ) {
                const fullChild = path.join( file, child );

                stats = await fs.stat( fullChild );
                
                if ( !await this.isExcluded( base, fullChild, stats ) ) {
                    if ( stats.isFile() ) {
                        yield this.yieldFileRecord( base, fullChild, stats );
                    } else if ( stats.isDirectory() ) {
                        yield * this.runSingle( base, fullChild, stats );
                    }
                }
            }
        }
    }

    run ( file : string, stats ?: fs.Stats, progress ?: LiveLogger ) : AsyncStream<[ string, fs.Stats ]> {
        if ( !path.isAbsolute( file ) ) {
            file = path.resolve( file );
        }

        let stream = new AsyncStream( this.runSingle( file, file, stats ) );

        if ( progress ) {
            stream = stream.tap( (v, i) => progress.info( `${ i + 1 } files` ) );
        }

        return stream;
    }
}