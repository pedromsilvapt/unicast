import { MediaKind, AllMediaKinds } from "../MediaRecord";
import { Tool, ToolOption } from "./Tool";
import * as chalk from 'chalk';

export interface LocateToolOptions {
    query : string;
    kind ?: MediaKind[];
}

export class LocateTool extends Tool<LocateToolOptions> {
    getParameters () {
        return [
            new ToolOption( 'query' ).setRequired( true ),
        ];
    }
    
    getOptions () {
        return [
            new ToolOption( 'kind' ).setRequired( true ).setVariadic( true ).setAllowedValues( AllMediaKinds ),
        ];
    }

    async run ( options : LocateToolOptions ) {
        const queryLower = options.query.toLowerCase();

        for await ( let movie of this.server.database.tables.movies.findStream().filter( movie => movie.title.toLowerCase().includes( queryLower ) ) ) {
            console.log( chalk.grey( movie.id ), chalk.cyan( movie.title ), chalk.cyan( movie.year ), '\n', chalk.green( movie.sources[ 0 ].id ), '\n' );
        }
    }
}