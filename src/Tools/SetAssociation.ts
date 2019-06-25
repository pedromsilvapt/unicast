import { MediaKind, AllMediaKinds } from "../MediaRecord";
import { Tool, ToolOption } from "./Tool";

export interface SetAssociationOptions {
    repository : string;
    kind : MediaKind;
    name : string;
    id : string;
}

export class SetAssociationTool extends Tool<SetAssociationOptions> {
    getParameters () {
        return [
            new ToolOption( 'repository' ).setRequired( true ),
            new ToolOption( 'kind' ).setRequired( true ).setAllowedValues( AllMediaKinds ),
            new ToolOption( 'name' ).setRequired( true ),
            new ToolOption( 'id' ).setRequired( true )
        ];
    }

    async run ( options : SetAssociationOptions ) {
        const repository = this.server.repositories.get( options.repository );

        if ( repository == null ) {
            throw new Error( `Repository named ${options.repository} not found.` );
        }

        repository.setPreferredMedia( options.kind, options.name, options.id );
    }
}