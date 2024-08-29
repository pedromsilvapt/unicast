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

        for (const table of [this.server.database.tables.movies, this.server.database.tables.episodes]) {
            for await ( let record of table.findStream() ) {
                let changed = false;

                for ( let source of record.sources ) {
                    if ( filesystem.match( source.id ) ) {
                        const new_hash = this.server.hash( source.id );

                        if (record.internalId != new_hash) {
                            this.log( 'Changing', source.id, 'with', new_hash );

                            record.internalId = this.server.hash( source.id );

                            changed = true;
                        }
                    }
                }

                if ( changed && !options.dryRun ) {
                    await table.update( record.id, { internalId: record.internalId } );
                }
            }
        }
    }
}
