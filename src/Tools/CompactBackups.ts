import * as fs from 'mz/fs';
import * as path from 'path';
import { Writable } from 'stream';
import * as tar from 'tar-fs';
import * as zlib from 'zlib';
import { Tool, ToolOption } from "./Tool";

interface CompactBackupsOptions {
    folder : string;
}

export class CompactBackupsTool extends Tool<CompactBackupsOptions> {
    getParameters () {
        return [
            new ToolOption( 'folder' ).setDefaultValue( this.server.storage.getPath( 'backups' ) ),
        ]
    }

    async compactFolder ( folder : string ) : Promise<void> {
        this.log( `Compacting folder ${ folder }` );

        const archivePath = `${folder}.tar.gz`;

        if ( await fs.exists( archivePath ) ) {
            await fs.unlink( archivePath );
        }

        var writeStream = tar.pack( folder )
            .pipe( zlib.createGzip( { level: 9 } ) )
            .pipe( fs.createWriteStream( `${folder}.tar.gz` ) );

        await streamToPromise( writeStream );

        // TODO Uncomment folder
        await fs.rmdir( folder );
    }

    async run ( options : CompactBackupsOptions ) {
        let { folder } = options;

        const folderContents = await fs.readdir( folder );

        for ( const contentName of folderContents ) {
            const contentPath = path.join( folder, contentName );

            // We check if the content exists because between scanning the folder
            // and reaching this element, it may have been deleted
            if ( !await fs.exists( contentPath ) ) {
                continue;
            }

            const stat = await fs.stat( contentPath );

            // Ignore anything that is not a directory
            if ( !stat.isDirectory() ) {
                continue;
            }

            try {
                await this.compactFolder( contentPath );
            } catch ( err ) {
                this.logger.error( `Failed to compact backup '${contentName}': ${err?.message || err}` );
                if ( err?.stackTrace != null ) {
                    this.logger.debug( err.stackTrace );
                }
            }
        }

        this.log( 'All backups compacted!' );
    }
}

// TODO Deduplicate
export function streamToPromise( stream: Writable ) : Promise<void> {
    return new Promise<void>( ( resolve, reject ) => {
        try {
            stream
                .on( 'error', reject)
                .on( 'finish', resolve );
        } catch ( err ) {
            reject( err );
        }
    } );
}
