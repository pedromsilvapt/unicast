import { EntityManager } from "../EntityManager";
import { Tool, ExecutionContext, LocalExecutionContext, ToolFactory, Class } from "./Tool";
import * as minimist from 'minimist';
import { FileWalker } from '../ES2017/FileWalker';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import * as chalk from 'chalk';

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

    protected async * readFolder ( folder : string ) : AsyncIterableIterator<Class<Tool>> {
        const fileWalker = new FileWalker();

        const ignoredFiles = [
           resolve( join( folder, 'Tool.js' ) ),
           resolve( join( folder, 'ToolsManager.js' ) ),
        ];

        for await ( let [ filePath, stats ] of fileWalker.run( folder ) ) {
            if ( !stats.isFile() ) {
                continue;
            }

            if ( extname( filePath ).toLowerCase() !== '.js' ) {
                continue;
            }
            
            if ( ignoredFiles.includes( filePath ) ) {
                continue;
            }

            const toolClassName = basename( filePath, extname( filePath ) ) + 'Tool';

            const toolModule = require( filePath );

            const relPath = relative( folder, filePath );

            if ( toolClassName in toolModule ) {
                const toolClass = toolModule[ toolClassName ] as Class<Tool>;

                if ( this.server.config.get( 'tools.logLoadedTools', false ) ) {
                    this.server.logger.debug( ToolsManager.name, `Loading ${ chalk.cyan( toolClassName ) } from ${ chalk.cyan( relPath ) }` );
                }
                
                yield toolClass;
            } else {
                if ( this.server.config.get( 'tools.warnMissingTools', true ) ) {
                    this.server.logger.warn( ToolsManager.name, `Tool ${ chalk.cyan( toolClassName ) } not found in ${ chalk.cyan( relPath ) }` );
                }
            }
        }
    }

    async addFolder ( folder : string = null ) : Promise<void> {
        if ( folder === null ) {
            folder = dirname( __filename );
        }

        for await ( let toolClass of this.readFolder( folder ) ) {
            this.add( new ToolFactory( toolClass ) );
        }
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