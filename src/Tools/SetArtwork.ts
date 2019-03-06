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
        
        await this.server.media.setArtwork( record, options.property, options.url );
    }
}