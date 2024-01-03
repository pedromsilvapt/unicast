import { FileSystemScanner } from '../../Extensions/MediaRepositories/FileSystem/FileSystemScanner';
import { MediaTools, ParsePathMode } from '../../MediaTools';
import { Tool, ToolOption, ToolValueType } from "../Tool";

export interface UpdateMovieQualitiesOptions {
    dryRun : boolean;
}

export class UpdateMovieQualitiesTool extends Tool<UpdateMovieQualitiesOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async run ( options : UpdateMovieQualitiesOptions ) {
        const filesystem = this.server.providers.get( 'filesystem' );

        const moviesTable = this.server.database.tables.movies;

        for await ( let record of moviesTable.findStream() ) {
            let changed = false;

            for ( let source of record.sources ) {
                if ( filesystem.match( source.id ) ) {
                    const quality = FileSystemScanner.parseQuality( source.id, ParsePathMode.Both );

                    if ( moviesTable.isChanged( record, { quality } ) ) {
                        this.log( 'Changing', record.title, JSON.stringify( record.quality ), 'to', JSON.stringify( quality ) );

                        record.quality = quality;

                        changed = true;

                        break;
                    }
                }
            }

            if ( changed ) {
                const table = this.server.media.getTable( record.kind );

                if ( !options.dryRun ) {
                    await table.update( record.id, { quality: record.quality } );
                }
            }
        }
    }
}
