import { MediaKind, AllMediaKinds } from "../MediaRecord";
import { Tool, ToolOption, ToolValueType } from "./Tool";
import * as shorthash from 'shorthash';

export interface SetAssociationOptions {
    repository : string;
    kind : MediaKind;
    name : string;
    id : string;
    hash : boolean;
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

    getOptions () {
        return [
            new ToolOption( 'Hash' ).setType( ToolValueType.Boolean ).setRequired( false ).setDefaultValue( false )
        ];
    }

    async run ( options : SetAssociationOptions ) {
        const repository = this.server.repositories.get( options.repository );

        if ( repository == null ) {
            throw new Error( `Repository named ${options.repository} not found.` );
        }

        const name = options.hash ? shorthash.unique( options.name ) : options.name;

        repository.setPreferredMedia( options.kind, name, options.id );

        await new Promise<void>( resolve => setTimeout( resolve, 1000 ) );
    }
}