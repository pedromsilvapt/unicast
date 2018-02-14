import * as yaml from 'js-yaml' 
import * as path from 'path';
import * as fs from 'mz/fs';
import * as ObjectPath from 'object-path';
import * as extend from 'extend';
import * as os from 'os';

function loadYamlFile ( file : string ) : any {
    if ( fs.existsSync( file ) ) {
        const content = fs.readFileSync( file, { encoding: 'utf8' } );

        return yaml.safeLoad( content );
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
            this.instance = new Config();
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

    static getFiles ( folder : string ) : string[] {
        const names : string[] = this.getFileNames();

        const files : string[] = [];

        for ( let name of names ) {
            if ( fs.existsSync( path.join( folder, name ) ) ) {
                files.push( name );
            }
        }
        
        return files;
    }

    static load ( folder : string ) : any {
        let data = {};

        let files = Config.getFiles( folder );

        for ( let file of files ) {
            const content = loadYamlFile( path.join( folder, file ) );

            data = extend( true, data, content );
        }

        return data;
    }

    data : any;

    constructor () {
        this.data = Config.load( path.join( process.cwd(), 'config' ) );
    }

    has ( path : string ) : boolean {
        return ObjectPath.has( this.data, path );
    }

    get<T = any> ( path : string, defaultValue ?: T ) : T {
        return ObjectPath.get( this.data, path, defaultValue );
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