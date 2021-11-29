import * as yaml from 'js-yaml' 
import * as path from 'path';
import * as fs from 'mz/fs';
import * as ObjectPath from 'object-path';
import * as extend from 'extend';
import * as os from 'os';
import * as ts from 'typescript';

function loadYamlFile ( file : string ) : any {
    if ( fs.existsSync( file ) ) {
        const content = fs.readFileSync( file, { encoding: 'utf8' } );

        return yaml.load( content );
    }

    return {};
}

async function loadYamlFileAsync ( file : string ) : Promise<any> {
    if ( await fs.exists( file ) ) {
        const content = await fs.readFile( file, { encoding: 'utf8' } );

        return yaml.load( content );
    }

    return {};
}

export interface ConfigContext {
    instance: string;
    short_hostname: string;
    full_hostname: string;
    deployment: string;
    platform: string;
}

export class Config {
    protected static instance : Config;

    static singleton () : Config {
        if ( !this.instance ) {
            this.instance = Config.load( path.join( process.cwd(), 'config' ) );
        }

        return this.instance;
    }

    static has ( path : string ) : boolean {
        return this.singleton().has( path );
    }

    static get<T = any> ( path : string, defaultValue ?: T ) : T {
        return this.singleton().get<T>( path, defaultValue );
    }

    static getContext () : ConfigContext {
        const env = process.env;
        const hostname = env.HOST || env.HOSTNAME || os.hostname();
        const platform = os.platform();

        return {
            instance: env.NODE_APP_INSTANCE,
            short_hostname: hostname.split( '.' )[ 0 ],
            full_hostname: hostname,
            deployment: env.NODE_ENV || 'development',
            platform: platform
        };
    }

    static getFileNames () : string[] {
        const context = Config.getContext();

        const check = ( strings : TemplateStringsArray, ...values : string[] ) : string => {
            if ( values.some( v => !v ) ) {
                return null;
            }

            return strings.map( ( s, i ) => i == 0 ? s : `${ values[ i - 1 ] }${ s }` ).join( '' ) + '.yaml';
        };

        return [
            check`default`,
            check`default-${context.platform}`,
            check`default-${context.instance}`,
            check`default-${context.instance}-${context.platform}`,
            check`default-${context.deployment}`,
            check`default-${context.deployment}-${context.platform}`,
            check`default-${context.deployment}-${context.instance}`,
            check`default-${context.deployment}-${context.instance}-${context.platform}`,
            check`${context.short_hostname}`,
            check`${context.short_hostname}-${context.platform}`,
            check`${context.short_hostname}-${context.instance}`,
            check`${context.short_hostname}-${context.instance}-${context.platform}`,
            check`${context.short_hostname}-${context.deployment}`,
            check`${context.short_hostname}-${context.deployment}-${context.platform}`,
            check`${context.short_hostname}-${context.deployment}-${context.instance}`,
            check`${context.short_hostname}-${context.deployment}-${context.instance}-${context.platform}`,
            check`${context.full_hostname}`,
            check`${context.full_hostname}-${context.platform}`,
            check`${context.full_hostname}-${context.instance}`,
            check`${context.full_hostname}-${context.instance}-${context.platform}`,
            check`${context.full_hostname}-${context.deployment}`,
            check`${context.full_hostname}-${context.deployment}-${context.platform}`,
            check`${context.full_hostname}-${context.deployment}-${context.instance}`,
            check`${context.full_hostname}-${context.deployment}-${context.instance}-${context.platform}`,
            check`local`,
            check`local-${context.platform}`,
            check`local-${context.instance}`,
            check`local-${context.instance}-${context.platform}`,
            check`local-${context.deployment}`,
            check`local-${context.deployment}-${context.platform}`,
            check`local-${context.deployment}-${context.instance}`,
            check`local-${context.deployment}-${context.instance}-${context.platform}`
        ].filter( name => name );
    }

    static async getFilesAsync ( folder : string ) : Promise<string[]> {
        if ( folder.toLowerCase().endsWith( '.yaml' ) ) {
            return [ '' ];
        }

        const names : string[] = this.getFileNames();

        const files : string[] = [];

        for ( let name of names ) {
            if ( await fs.exists( path.join( folder, name ) ) ) {
                files.push( name );
            }
        }
        
        return files;
    }

    static getFiles ( folder : string ) : string[] {
        if ( folder.toLowerCase().endsWith( '.yaml' ) ) {
            return [ '' ];
        }

        const names : string[] = this.getFileNames();

        const files : string[] = [];

        for ( let name of names ) {
            if ( fs.existsSync( path.join( folder, name ) ) ) {
                files.push( name );
            }
        }
        
        return files;
    }

    static async loadAsync ( folder : string ) : Promise<Config> {
        let data = {};

        let files = await Config.getFiles( folder );

        for ( let file of files ) {
            const content = await loadYamlFileAsync( path.join( folder, file ) );

            data = extend( true, data, content );
        }

        return new Config( data );
    }

    static load ( folder : string ) : Config {
        let data = {};

        let files = Config.getFiles( folder );

        for ( let file of files ) {
            const content = loadYamlFile( path.join( folder, file ) );

            data = extend( true, data, content );
        }

        return new Config( data );
    }

    static create ( data : any ) : Config {
        return new Config( data );
    }

    static merge ( configs : Config[] ) : Config {
        if ( configs.length == 1 ) {
            return configs[ 0 ];
        }

        let data = {};

        for ( let config of configs ) {
            data = extend( true, data, config.data );
        }
        
        return new Config( data );
    }

    data : any;

    constructor ( data : any ) {
        this.data = data;
    }

    has ( path : string ) : boolean {
        return ObjectPath.has( this.data, path );
    }

    get<T = any> ( path : string, defaultValue ?: T ) : T {
        return ObjectPath.get( this.data, path, defaultValue );
    }
    
    slice ( path : string ) : Config {
        return Config.create( this.get( path, {} ) );
    }

    clone () : Config {
        const data = JSON.parse( JSON.stringify( this.data ) );

        return Config.create( data );
    }
}

export interface ConfigInstanceOptions {
    key ?: string;
    list ?: string;
    defaults ?: any[];
}

export class ConfigInstances {
    static get ( key : string, type : string, options : ConfigInstanceOptions = {} ) {
        return new ConfigInstances( Config.singleton() ).get( key, type, options );
    }

    config : Config;

    constructor ( config ) {
        this.config = config;
    }

    get ( key : string, type : string, options : ConfigInstanceOptions = {} ) {
        const bag = this.config.get( key ) || [];

        let list;

        if ( !( bag instanceof Array ) ) {
            list = bag[ options.list || 'list' ];

            if ( !list ) {
                list = [];
            }
        } else {
            list = bag || [];
        }

        const instances = list.filter( instance => instance[ options.key || 'type' ] == type );

        if ( instances.length === 0 && bag && !( bag instanceof Array ) ) {
            const defaults = options.defaults;

            let allowDefaults = true;

            if ( typeof( bag.defaults ) === 'boolean' ) {
                allowDefaults = false;
            } else if ( bag.defaults ) {
                allowDefaults = !( type in bag.defaults ) || bag.defaults[ type ];
            }

            if ( allowDefaults ) {
                return defaults || [];
            }

            return [];
        }

        return instances;
    }
}

/* DYNAMIC CONFIG */
export type DynamicConfig<T> = {
    [P in keyof T]: T[P] | ((options : T) => T[P]);
}

export function createLazyProperties<T extends object> ( dynamic : DynamicConfig<T> ) : T {
    const lazy = {} as T;

    for ( let key of Object.keys( dynamic ) ) {
        
        if ( dynamic[ key ] instanceof Function ) {
            let state = {
                called: false,
                value: void 0
            };

            Object.defineProperty( lazy, key, {
                enumerable: true,
                get () {
                    if ( !state.called ) {
                        state.called = true;

                        return state.value = dynamic[ key ]( lazy );
                    }

                    return state.value;
                }
            } );
        } else {
            lazy[ key ] = dynamic[ key ];
        }
    }

    return lazy;
}

export function evaluate<T extends object> ( base : DynamicConfig<T>, ...extensions : DynamicConfig<Partial<T>>[] ) : T {
    const dynamicResult = {} as DynamicConfig<T>;

    for ( let extension of [ base, ...extensions ] ) {
        for ( let key of Object.keys( extension ) ) {
            dynamicResult[ key ] = extension[ key ];
        }
    }

    return { ...createLazyProperties( dynamicResult ) as any };
}
