import * as fs from 'mz/fs';
import * as path from 'path';
import { Tool, ToolOption, ToolValueType } from "./Tool";
import * as filesize from 'filesize';
import { AllMediaKinds, MediaRecordArt } from '../MediaRecord';
import chalk from 'chalk';

interface PruneCachedArtworkOptions {
    dryRun : boolean;
    caseSensitive : boolean;
}

export class PruneCachedArtworkTool extends Tool<PruneCachedArtworkOptions> {
    getOptions () {
        return [
            new ToolOption( 'DryRun' ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'CaseSensitive' ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
        ];
    }

    protected addToSet( set: Set<string>, url: string, caseSensitive: boolean = true ) {
        if (  url != null && url !== '') {
            if ( caseSensitive ) {
                set.add( url );
            } else {
                set.add( url.toLowerCase() );
            }
        }
    }

    protected hasInSet( set: Set<string>, url: string, caseSensitive: boolean = true ) {
        if (  url != null && url !== '') {
            if ( caseSensitive ) {
                return set.has( url );
            } else {
                return set.has( url.toLowerCase() );
            }
        } else {
            return false;
        }
    }

    protected addArtToSet( set: Set<string>, art: MediaRecordArt ) {
        this.addToSet( set, art.background );
        this.addToSet( set, art.banner );
        this.addToSet( set, art.poster );
        this.addToSet( set, art.thumbnail );
    }

    protected async getCurrentArtworkSet() : Promise<Set<string>> {
        const artworkUrls = new Set<string>();

        // First let's get the artwork from all the current media tables
        for ( const kind of AllMediaKinds ) {
            const table = this.server.media.getTable( kind );

            for await ( const record of table.findStream() ) {
                this.addArtToSet( artworkUrls, record.art );
            }
        }

        for await ( const person of this.server.database.tables.people.findStream() ) {
            this.addArtToSet( artworkUrls, person.art );
        }

        return artworkUrls;
    }

    protected async resolveArtworkFiles( artworkToKeep : Set<string>, caseSensitive: boolean ): Promise<Set<string>> {
        const artworkFilesToKeep = new Set<string>();

        await this.server.artwork.cache.load();

        for ( const [ cachedUrl, cachedFile ] of this.server.artwork.cache.data ) {
            const cachedUrlKey = cachedUrl.split( '?' )[ 0 ];

            if ( artworkToKeep.has( cachedUrlKey ) ) {
                this.addToSet( artworkFilesToKeep, this.server.artwork.getAbsoluteCachedPath( cachedFile ), caseSensitive );
            }
        }

        return artworkFilesToKeep;
    }

    protected async pruneFolders( artworkFolders: string[], artworkFilesToKeep: Set<string>, options: PruneCachedArtworkOptions ): Promise<PruneStats> {
        const stats: PruneStats = {
            bytesDeleted: 0, bytesKept: 0,
            filesDeleted: 0, filesKept: 0
        };

        for ( const folderPath of artworkFolders ) {
            for ( const fileName of await fs.readdir( folderPath ) ) {
                const filePath = path.join( folderPath, fileName );

                const fileStat = await fs.stat( filePath );

                if ( !fileStat.isFile() ) {
                    continue;
                }

                const shouldKeep = this.hasInSet( artworkFilesToKeep, filePath, options.caseSensitive );

                if ( shouldKeep ) {
                    stats.filesKept += 1;
                    stats.bytesKept += fileStat.size;
                } else {
                    stats.filesDeleted += 1;
                    stats.bytesDeleted += fileStat.size;

                    if ( !options.dryRun ) {
                        await fs.unlink( filePath );
                    }
                }
            }
        }

        return stats;
    }

    protected printStats( stats: PruneStats ) {
        this.log( `Kept ${chalk.green( '' + stats.filesKept )} files (${chalk.green( filesize( stats.bytesKept ) )})` );
        this.log( `Deleted ${chalk.red( '' + stats.filesDeleted )} files (${chalk.red( filesize( stats.bytesDeleted ) )})` );

        const percentage = stats.bytesDeleted * 100 / ( stats.bytesKept + stats.bytesDeleted );
        const percentageRounded = Math.round( percentage * 100 ) / 100;

        this.log( `Reclaimed ${chalk.red( '' + percentageRounded + '%' )} of space.` );
    }

    async run ( options : PruneCachedArtworkOptions ) {
        // Set of original and transformed artwork URLs to keep
        const artworkToKeep = await this.getCurrentArtworkSet();

        // Translate these artwork URLs into
        const artworkFilesToKeep = await this.resolveArtworkFiles( artworkToKeep, options.caseSensitive );

        // List of folders that we will prune the files from
        const artworkFolders = [
            this.server.storage.getPath( 'cache/artwork/original' ),
            this.server.storage.getPath( 'cache/artwork/transformed' ),
        ];

        this.log( JSON.stringify( options ) );
        const stats = await this.pruneFolders( artworkFolders, artworkFilesToKeep, options );

        this.printStats( stats );
    }
}

interface PruneStats {
    filesKept: number;
    bytesKept: number;
    filesDeleted: number;
    bytesDeleted: number;
}
