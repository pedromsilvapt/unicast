import { Tool, ToolOption, ToolValueType } from "../Tool";

export interface UpdateMovieInternalIdsOptions {
    truncate : boolean;
    dryRun : boolean;
}

export class UpdateMovieInternalIdsTool extends Tool<UpdateMovieInternalIdsOptions> {
    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setRequired( false ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ]
    }

    async run ( options : UpdateMovieInternalIdsOptions ) {
        const filesystem = this.server.providers.get( 'filesystem' );

        for await ( let record of this.server.database.tables.movies.findStream() ) {
            let changed = false;

            for ( let source of record.sources ) {
                if ( filesystem.match( source.id ) ) {
                    this.log( 'Changing', source.id, 'with', this.server.hash( source.id ) );
    
                    record.internalId = this.server.hash( source.id );
    
                    changed = true;
                }
            }

            if ( changed ) {
                const table = this.server.media.getTable( record.kind );

                if ( !options.dryRun ) {
                    await table.update( record.id, { sources: record.sources, internalId: record.internalId } );
                }
            }
        }
    }
}