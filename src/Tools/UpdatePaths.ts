import { Tool, ToolOption, ToolValueType } from "./Tool";
import { PlayableMediaRecord } from "../MediaRecord";
import * as shorthash from 'shorthash';

interface UpdatePathsOptions {
    oldPath : string;
    newPath : string;
    dryRun : boolean;
}

export class UpdatePathsTool extends Tool<UpdatePathsOptions> {
    getParameters () {
        return [
            new ToolOption( 'oldPath' ).setRequired(),
            new ToolOption( 'newPath' ).setRequired()
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'dryRun' ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ];
    }

    async * findPlayableRecords () : AsyncIterableIterator<PlayableMediaRecord> {
        const { tables } = this.server.database;

        let mediaTables = [ tables.movies, tables.episodes, tables.custom ];

        for ( let table of mediaTables ) {
            yield * await table.find();
        }
    }

    async run ( options : UpdatePathsOptions ) {
        const filesystem = this.server.providers.get( 'filesystem' );

        for await ( let record of this.findPlayableRecords() ) {
            let changed = false;

            for ( let source of record.sources ) {
                if ( filesystem.match( source.id ) && source.id.startsWith( options.oldPath ) ) {
                    const newPath = options.newPath + source.id.substr( options.oldPath.length );

                    this.log( 'Changing', source.id, 'with', newPath );

                    source.id = newPath;

                    record.internalId = shorthash.unique( newPath );

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