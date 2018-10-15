import { EntityManager } from "../EntityManager";
import { Tool, ExecutionContext, LocalExecutionContext } from "./Tool";
import { UnicastServer } from "../UnicastServer";
import * as minimist from 'minimist';

function splitArray<T> ( array : T[], separator : T ) : T[][] {
    let split : T[][] = [];

    if ( array.length > 0 ) {
        split.push( [] );
    }

    for ( let i = 0; i < array.length; i++ ) {
        if ( array[ i ] == separator ) {
            split.push( [] );
        } else {
            split[ split.length - 1 ].push( array[ i ] );
        }
    }

    return split;
}

export interface Class<T, C extends any[] = []> {
    new ( ...args : C ) : T;
}

export class ToolFactory<T> {
    name : string;

    server : UnicastServer;

    toolClass : Class<T, [ UnicastServer, ExecutionContext ]>;

    constructor ( toolClass : Class<T, [ UnicastServer, ExecutionContext ]>, name : string = null ) {
        this.toolClass = toolClass;

        if ( name === null ) {
            if ( toolClass.name.endsWith( 'Tool' ) ) {
                name = toolClass.name.slice( 0, -4 );
            } else {
                name = toolClass.name;
            }
        }

        this.name = name;
    }

    create ( server : UnicastServer, context : ExecutionContext ) : T {
        return new this.toolClass( server, context );
    }
}

export class ToolsManager extends EntityManager<ToolFactory<Tool>, string> {
    protected getEntityKey ( entity : ToolFactory<Tool> ) : string {
        return entity.name;
    }

    create<T extends Tool = Tool> ( name : string, context ?: ExecutionContext ) : T {
        if ( context == null ) {
            context = new LocalExecutionContext();
        }

        const factory = this.get( name );

        return factory.create( this.server, context ) as T;
    }

    async run ( tool : string | Tool, options : any, context ?: ExecutionContext ) : Promise<void> {
        if ( typeof tool == 'string' ) {
            tool = this.create( tool, context );
        }

        return Promise.race( [ tool.run( options ), tool.context.onResolve ] );
    }

    parse ( args : string[] = process.argv.slice( 2 ) ) : [ Tool, any ][] {
        const groupedArgs = splitArray( args, '--' ).slice( 1 );

        const tools : [ Tool, any ][] = [];

        for ( let args of groupedArgs ) {
            const parsed = minimist( args );

            const parameters : string[] = parsed._.slice( 1 );

            const toolName : string = parsed._[ 0 ];

            delete parsed._;

            const tool = this.create( toolName );

            const options : any = tool.parse( parameters, parsed );

            tools.push( [ tool, options ] );
        }

        return tools;
    }
}