import { UnicastServer } from "./UnicastServer";
import * as Module from 'module';
import * as path from 'path';
import * as fs from 'mz/fs';
import { FileWalker } from "./ES2017/FileWalker";
import { EntityManager } from "./EntityManager";
import { IEntity } from "./EntityFactory";
import * as chalk from 'chalk';
import { Synchronized } from 'data-semaphore';
import { Logger } from 'clui-logger';

let ts = null;

// Type Polyfill
declare module "module" {
    var _extensions: string[];
}

// Utility module loading functions

export function loadTextFile ( module, filename ) {
    var content = fs.readFileSync( filename, 'utf8' );

    try {
        module.exports = content;
    } catch ( err ) {
        err.message = filename + ': ' + err.message;

        throw err;
    }
}

export function loadTypescriptFile ( module, filename ) {
    if ( ts == null ) ts = require( 'typescript' );

    var content = fs.readFileSync( filename, 'utf8' );

    var code = ts.transpileModule( content, {
        compilerOptions: { module: ts.ModuleKind.CommonJS }
    } );

    module._compile( code, filename );
}

export class Extension implements IEntity {
    name : string;

    server: UnicastServer;

    logger : Logger;

    constructor ( name : string ) {
        this.name = name;
    }

    onEntityInit () {
        this.logger = this.server.extensions.logger.service( this.name );
        // throw new Error("Method not implemented.");
    }

    onEntityDestroy () {
        // throw new Error("Method not implemented.");
    }
}

export interface ExtensionsManagerConfig {
    [name: string]: {
        disable?: boolean
    }
}

export class ExtensionsManager extends EntityManager<Extension> {
    extensionsFolder : string = 'Extensions';

    protected patched : boolean = false;

    protected loaded : boolean = false;

    protected config : ExtensionsManagerConfig

    logger : Logger;

    constructor ( server : UnicastServer ) {
        super( server );

        this.logger = server.logger.service( 'Extensions' );

        this.config = server.config.get('extensions');
    }

    protected getEntityKey ( entity : Extension ) : Extension {
        return entity;
    }

    protected patch () {
        if ( this.patched ) return;

        this.patched = true;

        if ( !( '.txt' in Module._extensions ) ) {
            Module._extensions[ '.txt' ] = loadTextFile;
        }

        if ( !( '.ts' in Module._extensions ) ) {
            Module._extensions[ '.ts' ] = loadTypescriptFile;
        }

        if ( process.pkg ) {
            // Since pkg is awesome, all we have to do is
            const originalFolder = path.join( __dirname, this.extensionsFolder );
            const replacementFolder = path.join( process.cwd(), this.extensionsFolder );

            process.pkg.mount( originalFolder, replacementFolder );
        }
    }

    @Synchronized()
    async load () {
        if ( this.loaded ) return;

        this.loaded = true;

        this.patch();

        const folder = path.join( __dirname, this.extensionsFolder );

        const stat = await fs.stat( folder ).catch( () => null as fs.Stats );

        if ( stat && stat.isDirectory() ) {
            const extensions = await new FileWalker().run( folder, stat )
                .filter( ( [ _, stat ] ) => stat.isFile() ).map( ( [ file ] ) => file )
                .filter( file => {
                    const basename = path.basename( file ).toLowerCase();

                    return basename == 'extension.js' || basename == 'extension.ts';
                } )
                .filter( file => path.dirname( file ) !== folder )
                .toArray();

            let loadedCount = 0;

            for ( let file of extensions ) {
                const name = path.basename( path.dirname( file ) );

                const namespacedName = path.relative( folder, path.dirname( file ) ).replace( /\\/g, '/' );

                if ( this.config[ namespacedName ]?.disable ) {
                    this.logger.info(`Extension ${ chalk.yellow( namespacedName ) } is disabled in config.`)
                    continue;
                }

                // Require the extension main file
                const exports = require( file );

                // Iterate through all the exports of the file and find the first that extends the `Extension` class
                const extensionClass = Object.keys( exports ).map( key => exports[ key ] ).filter( value => value.prototype instanceof Extension )[ 0 ];

                if ( !extensionClass ) {
                    this.logger.error( `Extension ${ chalk.red( namespacedName ) } could not be loaded: No Extension object found.` );
                } else {
                    const extension = new extensionClass( name );

                    this.add( extension );

                    this.logger.info( `Extension ${ chalk.yellow( namespacedName ) } loaded.` );

                    loadedCount += 1;
                }
            }

            this.logger.info( `All (${ chalk.yellow( loadedCount ) }) extensions loaded.` );
        }
    }
}
