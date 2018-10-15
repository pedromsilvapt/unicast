import { Tool, ToolOption } from "./Tool";
import { UnicastServer } from "../UnicastServer";
import { MediaKind } from "../MediaRecord";
import * as fs from 'mz/fs';

interface LoadArtworkOptions {
    ids ?: string[];
    properties ?: string[];
    input : string;
    kind : MediaKind;
    repository : string;
}

export class LoadArtworkTool extends Tool<LoadArtworkOptions> {
    getParameters () {
        return [
            new ToolOption( 'input' ).setRequired(),
            new ToolOption( 'kind' ).setRequired(),
            new ToolOption( 'repository' ).setRequired()
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'id' ).saveTo( 'ids' ).setVariadic(),
            new ToolOption( 'property' ).saveTo( 'properties' ).setVariadic()
        ]
    }

    async run ( options : LoadArtworkOptions ) {
        const repository = this.server.repositories.get( options.repository );

        for ( let record of JSON.parse( await fs.readFile( options.input, 'utf8' ) ) ) {
            this.log( record.id, record.title, record.art.poster );
            
            const match = await this.server.media.get( options.kind, record.id );

            for ( let property of options.properties ) {
                if ( match.art[ property ] != record.art[ property ] ) {
                    repository.setPreferredMediaArt( match.kind, match.id, property, record.art[ property ] );

                    match.art[ property ] = record.art[ property ];
                }
            }

            // if ( match.art.poster != show.art.poster ) {
            //     repository.setPreferredMediaArt( match.kind, match.id, 'poster', show.art.poster );
            // }

            // if ( match.art.banner != show.art.banner ) {
            //     repository.setPreferredMediaArt( match.kind, match.id, 'banner', show.art.banner );
            // }

            // if ( match.art.background != show.art.background ) {
            //     repository.setPreferredMediaArt( match.kind, match.id, 'background', show.art.background );
            // }

            const table = this.server.media.getTable( options.kind );

            await table.update( match.id, {
                art: match.art
            } );
            // await server.database.tables.shows.update( show.id, { 
            //     art: {
            //         ...match.art,
            //         poster: show.art.poster,
            //         banner: show.art.banner,
            //         background: show.art.background,
            //     }
            // } );
        }
    }
} 