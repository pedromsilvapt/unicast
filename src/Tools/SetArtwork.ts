import { MediaKind, AllMediaKinds } from "../MediaRecord";
import { Tool, ToolOption } from "./Tool";

export interface SetArtworkOptions {
    kind : MediaKind;
    id : string;
    property : string;
    url : string;
}

export class SetArtworkTool extends Tool<SetArtworkOptions> {
    getParameters () {
        return [
            new ToolOption( 'kind' ).setRequired( true ).setAllowedValues( AllMediaKinds ),
            new ToolOption( 'id' ).setRequired( true ),
            new ToolOption( 'property' ).setRequired( true ),
            new ToolOption( 'url' ).setRequired( true )
        ];
    }

    async run ( options : SetArtworkOptions ) {
        const record = await this.server.media.get( options.kind, options.id );
        
        const repository = this.server.repositories.get( record.repository );

        if ( repository ) {
            repository.setPreferredMediaArt( record.kind, record.id, options.property, options.url );
        } else {
            this.log( `No repository named ${ record.repository } was found. Skipping setting repository.` );
        }

        record.art[ options.property ] = options.url;

        const table = this.server.media.getTable( record.kind );

        await table.update( record.id, { art: record.art } );
    }
}