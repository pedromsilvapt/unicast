import { Tool } from "./Tool";
import { MediaKind } from "../MediaRecord";
import { FileSystemRepository } from '../Extensions/MediaRepositories/FileSystem/FileSystemRepository';
import { TvShowLocalRecord } from '../Extensions/MediaRepositories/FileSystem/FileSystemScanner';

export interface FileSystemCustomizationOptions { }

/**
 * Find all FileSystem local media customization files and their contents for TvShows
 */
export class FileSystemCustomizationTool extends Tool<FileSystemCustomizationOptions> {
    getParameters () {
        return [];
    }

    async run ( options : FileSystemCustomizationOptions ) {
        const repositories = Array.from( this.server.repositories );

        for ( const repository of repositories ) {
            if ( !repository.hasMediaKind( MediaKind.TvShow ) ) {
                continue;
            }

            if ( repository instanceof FileSystemRepository ) {
                // Local Scan is an alternative to a real scan: it lists the records 
                // found in disk but does not try to gather any sort of remote 
                // information about them (does not use the scraper)
                for await ( const localRecord of repository.scanLocal<TvShowLocalRecord>( [ MediaKind.TvShow ] ) ) {
                    if ( localRecord.localSettings != null && Object.keys( localRecord.localSettings ).length > 0 ) {
                        this.logger.info( 'SHOW ' + localRecord.title );
                        this.logger.debug( JSON.stringify( localRecord.localSettings, null, 4 ) );
                    }
                }
            }
        }
    }
}
