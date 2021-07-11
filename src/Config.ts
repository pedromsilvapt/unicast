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

export class SchemaValidationError {
    expected : string[];
    received : string;
    property ?: string;

    constructor ( expected : string[] | string, received : string, property : string = null ) {
        this.property = property;
        
        if ( expected instanceof Array ) {
            this.expected = expected;
        } else {
            this.expected = [ expected ];
        }

        this.received = received;
    }

    prefix ( property : string ) : SchemaValidationError {
        if ( this.property == null ) {
            return new SchemaValidationError( this.expected, this.received, property );
        }

        return new SchemaValidationError( this.expected, this.received, property + '.' + this.property );
    }

    get message () {
        const expectations = `Expected ${ this.expected.join( ', ' ) }, got ${ this.received } instead.`;

        if ( this.property !== null ) {
            return `${ this.property }: ${ expectations }`
        } else {
            return expectations;
        }
    }

    public static prefix ( errors : SchemaValidationResult, property : string ) : SchemaValidationResult {
        if ( !errors ) {
            return  null;
        }

        if ( errors instanceof Array ) {
            return errors.map( error => error.prefix( property ) );
        } else {
            return errors.prefix( property );
        }
    }

    public static toString ( errors ?: SchemaValidationResult ) : string {
        if ( !errors ) {
            return  null;
        }

        if ( errors instanceof Array ) {
            return errors.map( error => error.message ).join( '\n' );
        } else {
            return errors.message;
        }
    }
}

export type SchemaValidationResult = null | SchemaValidationError | SchemaValidationError[];

export abstract class TypeSchema {
    static normalize ( schema : any ) : TypeSchema {
        if ( schema instanceof TypeSchema ) {
            return schema;
        } else if ( schema instanceof Array ) {
            if ( schema.length == 0 ) {
                return ArrayTypeSchema.normalize( new AnyTypeSchema() );
            } else if ( schema.length == 1 ) {
                return ArrayTypeSchema.normalize( schema );
            } else {
                return TupleTypeSchema.normalize( schema );
            }
        } else if ( schema === String ) {
            return new StringTypeSchema();
        } else if ( schema === Number ) {
            return new NumberTypeSchema();
        } else if ( schema === Boolean ) {
            return new BooleanTypeSchema();
        } else if ( typeof schema === 'object' ) {
            return ObjectTypeSchema.normalize( schema );
        } else {
            return new ConstantTypeSchema( schema );
        }
    }

    public static toCodeAst ( value : unknown ) : ts.Expression {
        if ( value === null ) {
            return ts.createNull();
        } else if ( value === void 0 ) {
            return ts.createVoidZero();
        } else if ( value instanceof TypeSchema ) {
            return value.toCodeAst();
        } else if ( value instanceof Array ) {
            return ts.createArrayLiteral(
                value.map( subValue => TypeSchema.toCodeAst( subValue ) ),
                true
            );
        } else if ( typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' ) {
            return ts.createLiteral( value );
        } else if ( typeof value === 'object' ) {
            return ts.createObjectLiteral( 
                Object.keys( value ).map( 
                    key => ts.createPropertyAssignment( key, TypeSchema.toCodeAst( value[ key ] ) )
                )
            );
        } else {
            throw new Error(`Cannot convert ${ value } into a code AST.`);
        }
    }

    public toCodeAst () : ts.Expression {
        const parameters = this.getFactoryParameters();

        return ts.createNew(
            ts.createIdentifier( this.constructor.name ),
            [],
            parameters.map( value => TypeSchema.toCodeAst( value ) ),
        );
    }

    public toCode () : string {
        const resultFile = ts.createSourceFile(
            "schema.ts",
            "",
            ts.ScriptTarget.Latest,
            /*setParentNodes*/ false,
            ts.ScriptKind.TS
        );

        const printer = ts.createPrinter( {
            newLine: ts.NewLineKind.LineFeed,
        } );

        const result = printer.printNode(
            ts.EmitHint.Unspecified,
            this.toCodeAst(),
            resultFile,
        );
        
        return result;
    }

    public toType () : string {
        const resultFile = ts.createSourceFile(
            "schema.ts",
            "",
            ts.ScriptTarget.Latest,
            /*setParentNodes*/ false,
            ts.ScriptKind.TS
        );

        const printer = ts.createPrinter( {
            newLine: ts.NewLineKind.LineFeed,
        } );

        const result = printer.printNode(
            ts.EmitHint.Unspecified,
            this.toTypeAst(),
            resultFile,
        );
        
        return result;
    }

    abstract getFactoryParameters () : unknown[];

    abstract toTypeAst () : ts.TypeNode;

    abstract validate ( data : any ) : SchemaValidationResult;

    abstract run ( data : any ) : any;
}

export class ConstantTypeSchema extends TypeSchema {
    constant : any = null;

    constructor ( constant : any ) {
        super();

        this.constant = constant;
    }

    getFactoryParameters () {
        return [ this.constant ];
    }

    toTypeAst () {
        return ts.createLiteralTypeNode( ts.createLiteral( this.constant ) );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( data == this.constant ) {
            return null;
        }

        return new SchemaValidationError( `"${ this.constant }"`, `"${ data }"` );
    }

    run ( data : any ) {
        return this.constant;
    }
}

export class OptionalTypeSchema extends TypeSchema {
    subSchema : TypeSchema;

    defaultValue : any = null;

    constructor ( subSchema : any, defaultValue : any = null ) {
        super();

        this.subSchema = TypeSchema.normalize( subSchema );

        this.defaultValue = defaultValue;
    }

    getFactoryParameters () {
        return [ this.subSchema, this.defaultValue ];
    }

    toTypeAst () {
        if ( this.defaultValue === null ) {
            return this.subSchema.toTypeAst();
        }

        return ts.createIntersectionTypeNode( [
            this.subSchema.toTypeAst(),
            ts.createTypeReferenceNode( "Default", [ ts.createLiteralTypeNode( ts.createLiteral( this.defaultValue ) ) ] )
        ] );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( data === null || data === void 0 ) {
            return null;
        }

        return this.subSchema.validate( data );
    }

    run ( data : any ) {
        if ( data === null || data === void 0 ) {
            data = this.defaultValue;
        }

        return this.subSchema.run( data );
    }
}

export class AnyTypeSchema extends TypeSchema {
    getFactoryParameters () {
        return [];
    }

    toTypeAst () {
        return ts.createKeywordTypeNode( ts.SyntaxKind.AnyKeyword );
    }

    validate () {
        return null;
    }

    run ( data : any ) {
        return data;
    }
}

export class UnionTypeSchema extends TypeSchema {
    typeSchemas: TypeSchema[];
    
    constructor ( ...typeSchemas: any[] ) {
        super();

        this.typeSchemas = typeSchemas.map( type => TypeSchema.normalize( type ) );
    }
    
    getFactoryParameters () {
        return this.typeSchemas;
    }

    toTypeAst () {
        const types = this.typeSchemas.map( schema => schema.toTypeAst() );
        
        return ts.createUnionTypeNode( types );
    }

    validate ( data : any ) : SchemaValidationResult {
        const errors: SchemaValidationError[] = [];

        for ( const schema of this.typeSchemas ) {
            const schemaErrors = schema.validate( data );

            if ( schemaErrors === null ) {
                return null;
            }

            if ( schemaErrors instanceof Array ) {
                errors.push( ...schemaErrors );
            } else {
                errors.push( schemaErrors );
            }
        }

        if ( errors.length === 0 ) {
            return null;
        }

        return errors;
    }

    run ( data : any ) {
        for ( const schema of this.typeSchemas ) {
            const schemaErrors = schema.validate( data );

            if ( schemaErrors === null ) {
                return schema.run( schema );
            }
        }

        return data;
    }
}

export class IntersectionTypeSchema extends TypeSchema {
    typeSchemas: TypeSchema[];
    
    constructor ( ...typeSchemas: any[] ) {
        super();

        this.typeSchemas = typeSchemas.map( type => TypeSchema.normalize( type ) );
    }

    getFactoryParameters () {
        return this.typeSchemas;
    }

    toTypeAst () {
        const types = this.typeSchemas.map( schema => schema.toTypeAst() );
        
        return ts.createIntersectionTypeNode( types );
    }

    validate ( data : any ) : SchemaValidationResult {
        const errors: SchemaValidationError[] = [];

        for ( const schema of this.typeSchemas ) {
            const schemaErrors = schema.validate( data );

            if ( schemaErrors instanceof Array ) {
                errors.push( ...schemaErrors );
            } else if ( schemaErrors != null ) {
                errors.push( schemaErrors );
            }
        }

        if ( errors.length === 0 ) {
            return null;
        }

        return errors;
    }

    run ( data : any ) {
        for ( const schema of this.typeSchemas ) {
            data = schema.run( data );
        }

        return data;
    }
}

export class StringTypeSchema extends TypeSchema {
    getFactoryParameters () {
        return [];
    }

    toTypeAst () {
        return ts.createKeywordTypeNode( ts.SyntaxKind.StringKeyword );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( typeof data === 'string' ) {
            return null;
        }

        return new SchemaValidationError( 'String', typeof data );
    }

    run ( data : any ) {
        return data;
    }
}

export class NumberTypeSchema extends TypeSchema {
    public strict: boolean;
    
    public constructor (strict: boolean = true) {
        super();

        this.strict = strict;
    }

    getFactoryParameters () {
        return [];
    }

    toTypeAst () {
        return ts.createKeywordTypeNode( ts.SyntaxKind.NumberKeyword );
    }

    validate ( data : any ) {
        if ( typeof data === 'number' ) {
            return null;
        }

        if ( this.strict === false && typeof data === 'string' ) {
            try {
                parseInt(data);

                return null;
            } catch {}
        }

        return new SchemaValidationError( 'Number', typeof data );
    }

    run ( data : any ) {
        return data;
    }
}


export class BooleanTypeSchema extends TypeSchema {
    getFactoryParameters () {
        return [];
    }

    toTypeAst () {
        return ts.createKeywordTypeNode( ts.SyntaxKind.BooleanKeyword );
    }

    validate ( data : any ) {
        if ( typeof data === 'boolean' ) {
            return null;
        }

        return new SchemaValidationError( 'Boolean', typeof data );
    }

    run ( data : any ) {
        return data;
    }
}

export class TupleTypeSchema extends TypeSchema {
    static normalize ( schema : any ) : TupleTypeSchema {
        return new TupleTypeSchema( schema );
    }

    subSchema : TypeSchema[];

    constructor ( schema : any[] ) {
        super();

        this.subSchema = [];

        for ( let type of schema ) {
            this.subSchema.push( TypeSchema.normalize( type ) );
        }
    }

    getFactoryParameters () {
        return [ this.subSchema ];
    }

    toTypeAst () {
        const types = this.subSchema.map( schema => schema.toTypeAst() );
        
        return ts.createTupleTypeNode( types );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( data instanceof Array ) {
            const errors = data.map( ( item, index ) => {
                    if ( this.subSchema.length <= index ) {
                        return new SchemaValidationError( 'Undefined', typeof item );
                    }

                    const errors = this.subSchema[ index ].validate( item );

                    if ( errors instanceof Array ) {
                        return errors.map( err => err.prefix( index.toString() ) );
                    } else if ( errors !== null ) {
                        return errors.prefix( index.toString() );
                    }
                } ).filter( error => error != null )
                .reduce( ( arr, errors ) => {
                    if ( errors instanceof Array ) {
                        arr.push( ...errors );
                    } else {
                        arr.push( errors )
                    }

                    return arr;
                }, [] as any[] );

                if ( errors.length === 0 ) {
                    return null;
                }

                return errors;
        }

        return new SchemaValidationError( 'Array', typeof data );
    }

    run ( data : any ) {
        if ( data instanceof Array ) {
            return data.map( ( entry, index ) => {
                if ( index < this.subSchema.length ) {
                    return this.subSchema[ index ].run( entry )
                }

                return entry;
            } );
        }
        
        return data;
    }
}

export class ArrayTypeSchema extends TypeSchema {
    static normalize ( schema : any ) : TypeSchema {
        return new ArrayTypeSchema( TypeSchema.normalize( schema[ 0 ] ) );
    }

    subSchema : TypeSchema;

    constructor ( subSchema : any ) {
        super();

        this.subSchema = TypeSchema.normalize( subSchema );
    }

    getFactoryParameters () {
        return [ this.subSchema ];
    }

    toTypeAst () {
        return ts.createArrayTypeNode( this.subSchema.toTypeAst() );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( data instanceof Array ) {
            const errors = data.map( ( item, index ) => {
                    const errors = this.subSchema.validate( item );

                    if ( errors instanceof Array ) {
                        return errors.map( err => err.prefix( index.toString() ) );
                    } else if ( errors !== null ) {
                        return errors.prefix( index.toString() );
                    }
                } )
                .filter( error => error != null )
                .reduce( ( arr, errors ) => {
                    if ( errors instanceof Array ) {
                        arr.push( ...errors );
                    } else {
                        arr.push( errors )
                    }

                    return arr;
                }, [] as any[] );

                if ( errors.length === 0 ) {
                    return null;
                }

                return errors;
        }

        return new SchemaValidationError( 'Array', typeof data );
    }

    run ( data : any ) {
        if ( data instanceof Array ) {
            return data.map( entry => this.subSchema.run( entry ) );
        }
        
        return data;
    }
}

export class ObjectTypeSchema extends TypeSchema {
    static normalize ( schema : any ) : TypeSchema {
        return new ObjectTypeSchema( schema );
    }

    subSchema : { [ key : string] : TypeSchema };

    // If true, keys that are not defined in the schema are not allowed
    strict : boolean;

    constructor ( subSchema : any, strict : boolean = false ) {
        super();

        this.subSchema = {};

        for ( let key of Object.keys( subSchema ) ) {
            this.subSchema[ key ] = TypeSchema.normalize( subSchema[ key ] );
        }

        this.strict = strict;
    }

    getFactoryParameters () {
        return [ this.subSchema, this.strict ];
    }

    toTypeAst () {
        const properties = Object.keys( this.subSchema )
            .map( key => {
                const schema = this.subSchema[ key ];

                if ( schema instanceof OptionalTypeSchema ) {
                    return ts.createPropertySignature( 
                        void 0,
                        ts.createIdentifier( key ),
                        ts.createToken(ts.SyntaxKind.QuestionToken),
                        schema.subSchema.toTypeAst(),
                        TypeSchema.toCodeAst( schema.defaultValue ),
                    );
                }
                
                return ts.createPropertySignature( 
                    void 0,
                    ts.createIdentifier( key ),
                    void 0,
                    schema.toTypeAst(),
                    void 0,
                );
            } );
        
        return ts.createTypeLiteralNode( properties );
    }

    validate ( data : any ) : SchemaValidationResult {
        if ( data && typeof data === 'object' ) {
            const errors : SchemaValidationError[] = [];

            const requiredKeys = new Set( Object.keys( this.subSchema ) );

            for ( let key of Object.keys( data ) ) {
                if ( !( key in this.subSchema ) && this.strict ) {
                    errors.push( new SchemaValidationError( 'Undefined', typeof data[ key ], key ) )
                } else if ( key in this.subSchema ) {
                    requiredKeys.delete( key );

                    const keyErrors = this.subSchema[ key ].validate( data[ key ] );

                    if ( keyErrors instanceof Array ) {
                        errors.push( ...keyErrors.map( error => error.prefix( key ) ) );
                    } else if ( keyErrors !== null ) {
                        errors.push( keyErrors.prefix( key ) );
                    }
                }
            }

            for ( let key of requiredKeys ) {
                const keyErrors = this.subSchema[ key ].validate( void 0 );

                if ( keyErrors instanceof Array ) {
                    errors.push( ...keyErrors.map( error => error.prefix( key ) ) );
                } else if ( keyErrors !== null ) {
                    errors.push( keyErrors.prefix( key ) );
                }
            }

            if ( errors.length === 0 ) {
                return null;
            }

            return errors;
        }

        return new SchemaValidationError( 'Object', typeof data );
    }

    run ( data : any ) {
        const requiredKeys = new Set( Object.keys( this.subSchema ) );

        const result : any = {};

        for ( let key of Object.keys( data ) ) {
            if ( key in this.subSchema ) {
                requiredKeys.delete( key );

                result[ key ] = this.subSchema[ key ].run( data[ key ] );
            } else {
                result[ key ] = data[ key ];
            }
        }

        for ( let key of requiredKeys ) {
            result[ key ] = this.subSchema[ key ].run( data[ key ] );
        }

        return result;
    }
}

// Functional DSL
export function any () {
    return new AnyTypeSchema();
}

export function array ( subSchema : any ) {
    return new ArrayTypeSchema( subSchema );
}

export function object ( subSchema : any = {}, strict : boolean = false ) {
    return new ObjectTypeSchema( subSchema, strict );
}

export function union ( ...typeSchemas : any[] ) {
    return new UnionTypeSchema( ...typeSchemas );
}

export function intersection ( ...typeSchemas : any[] ) {
    return new IntersectionTypeSchema( ...typeSchemas );
}

export function tuple ( subSchema : any ) {
    return new TupleTypeSchema( subSchema );
}

export function constant ( constant : any ) {
    return new ConstantTypeSchema( constant );
}

export function number () {
    return new NumberTypeSchema();
}

export function boolean () {
    return new BooleanTypeSchema();
}

export function optional ( subSchema : any, defaultValue : any = null ) {
    return new OptionalTypeSchema( subSchema, defaultValue );
}

export function string () {
    return new StringTypeSchema();
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
