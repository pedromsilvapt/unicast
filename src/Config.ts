import * as yaml from 'js-yaml' 
import * as path from 'path';
import * as fs from 'mz/fs';
import * as ObjectPath from 'object-path';
import * as extend from 'extend';

function loadYamlFile ( file : string ) : any {
    if ( fs.existsSync( file ) ) {
        const content = fs.readFileSync( file, { encoding: 'utf8' } );

        return yaml.safeLoad( content );
    }

    return {};
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

    data : any;

    constructor () {
        const contentDefault = loadYamlFile( path.join( process.cwd(), 'config/config.yaml' ) );

        const contentLocal = loadYamlFile( path.join( process.cwd(), 'config/local.yaml' ) );

        this.data = extend( true, contentDefault, contentLocal );
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