import { UnicastServer } from "../UnicastServer";
import { Future } from "@pedromsilva/data-future";
import { DiagnosticsService } from "../Diagnostics";

export enum ToolValueType {
    String = 'string',
    Number = 'number',
    Boolean = 'boolean'
}

export type ToolOptionValidator = ( value : any, options : any, schema : ToolOption ) => boolean | string | Error;

export type ToolOptionTransformer = ( value : any, options : any, schema : ToolOption ) => any;

export class ToolOptionInvalid extends Error {}

export class ToolOption {
    name : string;

    saveToName : string;

    required : boolean = false;

    type : ToolValueType = ToolValueType.String;

    description : string;

    variadic : boolean = false;

    defaultValue : any = null;

    allowedValues : any[] = null;

    customValidator : ToolOptionValidator = null;

    customTransformer : ToolOptionTransformer = null;

    constructor ( name : string ) {
        this.name = name;
        this.saveToName = name;
    }

    saveTo ( name : string ) : this {
        this.saveToName = name;
        
        return this;
    }

    setRequired ( required : boolean = true ) : this {
        this.required = required;
        
        return this;
    }

    setType ( type : ToolValueType ) : this {
        this.type = type;

        return this;
    }

    setDescription ( description : string ) : this {
        this.description = description;

        return this;
    }

    setVariadic ( variadic : boolean = true ) : this {
        this.variadic = variadic;
        
        return this;
    }

    setDefaultValue ( value : any ) : this {
        this.defaultValue = value;
        
        return this;
    }

    setAllowedValues ( values : any[] ) : this {
        this.allowedValues = values;

        return this;
    }

    setValidator ( validator : ToolOptionValidator ) : this {
        this.customValidator = validator;
        
        return this;
    }

    setTransformer ( transformer : ToolOptionTransformer ) : this {
        this.customTransformer = transformer;
        
        return this;
    }

    receive ( options : any, exists : boolean, value : any ) : void {
        if ( !exists && this.defaultValue ) {
            options[ this.saveToName ] = this.defaultValue;
        } else if ( exists ) {
            if ( this.type === ToolValueType.Number ) {
                value = Number.parseFloat( value );

                if ( Number.isNaN( value ) ) {
                    throw new ToolOptionInvalid( `Option ${ this.name } expected a ${ this.type }, invalid value given.` );                    
                }
            } else if ( this.type === ToolValueType.Boolean ) {
                value = value.toLowerCase();

                if ( value === 'false' || value === '0' ) {
                    value = false;
                } else if ( value === 'true' || value === '1' ) {
                    value = true;
                } else {
                    throw new ToolOptionInvalid( `Option ${ this.name } expected a ${ this.type }, invalid value given.` );
                }
            }

            if ( this.allowedValues ) {
                if ( !this.allowedValues.includes( value ) ) {
                    throw new ToolOptionInvalid( `Option ${ this.name } expected ${ this.allowedValues.join( ', ' ) }, got ${ value } instead.` );
                }
            }

            if ( this.customValidator ) {
                const customError = this.customValidator( value, options, this );

                if ( customError === false ) {
                    throw new Error( `Option ${ this.name }'s value is invalid.` );
                } else if ( typeof customError === 'string' ) {
                    throw new Error( customError );
                } else if ( customError instanceof Error ) {
                    throw customError;
                }
            }

            if ( this.customTransformer ) {
                value = this.customTransformer( value, options, this );
            }

            if ( this.variadic ) {
                if ( !( this.saveToName in options ) ) {
                    options[ this.saveToName ] = [ value ];
                } else {
                    options[ this.saveToName ].push( value );
                }
            } else {
                options[ this.saveToName ] = value;
            }
        }
    }

    toString () {
        let string = `${ this.name } : ${ this.type }${ this.variadic ? '[]' : '' }`;

        if ( this.defaultValue !== null ) {
            string += ' = ' + this.defaultValue;
        }

        if ( this.description ) {
            string += ' ' + this.description;
        }
    }
}

export interface ExecutionContext {
    readonly isResolved : boolean;
    
    onResolve : Promise<void>;

    log ( ...any : string[] ) : void;

    resolve ( error ?: any ) : void;
}

export class LocalExecutionContext implements ExecutionContext {
    protected onResolveFuture : Future<void> = new Future();
    
    onResolve : Promise<void> = this.onResolveFuture.promise;

    isResolved : boolean = false;

    log ( ...any : string[] ) : void {
        console.log( ...any );
    }

    resolve ( error ?: any ) : void {
        this.isResolved = true;

        if ( error != null ) {
            this.onResolveFuture.reject( error );
        } else{
            this.onResolveFuture.resolve();
        }
    }
}

export abstract class Tool<O = any> {
    server : UnicastServer;

    context : ExecutionContext;

    diagnostics : DiagnosticsService;

    constructor ( server : UnicastServer, context : ExecutionContext ) {
        this.server = server;
        this.context = context;
        this.diagnostics = server.diagnostics.service( 'Tools/' + this.getName() );
    }

    getName () {
        return this.constructor.name;
    }

    getDescription () {
        return null;
    }

    getParameters () : ToolOption[] {
        return [];
    }

    getOptions () : ToolOption[] {
        return [];
    }

    log ( ...messages : any[] ) {
        this.diagnostics.info( messages.join( ' ' ) );
    }

    help () : string {
        const headerHelp = `Tool ${ this.getName() }:\n`;

        const descriptionHelp = this.getDescription() ? ( this.getDescription() + '\n\n' ) : '\n';

        const parametersList = this.getParameters();

        const parametersHeaderHelp = 'Parameters:\n';

        const parametersHelp = parametersList.length ? ( parametersHeaderHelp + parametersList.map( p => p.toString() ).join( '\n' ) + '\n' ) : '';

        const optionsList = this.getOptions();
        
        const optionsHeaderHelp = 'Options:\n';

        const optionsHelp = optionsList.length ? ( optionsHeaderHelp + optionsList.map( op => op.toString() ).join( '\n' ) + '\n' ) : '';

        return headerHelp + descriptionHelp + parametersHelp + optionsHelp;
    }

    parse ( parameters : string[], parsed : any ) : any {
        const parametersSchema = this.getParameters();

        const options : any = {};

        // Validation: 
        // - only the last parameter can be variadic
        // - all optional parameters must be grouped at the end of the array
        const onlyLastParameterVariadic = parametersSchema.slice( 0, -1 ).every( ( p, i, a ) => !p.variadic || i == a.length  - 1 );
        const allOptionalsAtEnd = parametersSchema.every( ( p, i, a ) => i == a.length - 1 || !p.variadic || a[ i + 1 ].variadic );

        if ( !onlyLastParameterVariadic ) {
            throw new Error( `Only the last parameter can be variadic.` );
        }

        if ( !allOptionalsAtEnd ) {
            throw new Error( `Cannot have required parameters after optional ones` );
        }

        // Three cases (regarding the length of the parameters and schema arrays):
        //  - Both arrays (parameters and schema) have the same length => each parameter corresponds to each schema
        //  - Schema array is larger => all schemas after the last parameter *must* be optional
        //  - Parameters array is larger => last schema *must* be variadic and the overflow belongs to it as well
        if ( parametersSchema.length > parameters.length ) {
            const extraSchemasOptional = parametersSchema.slice( parameters.length ).every( p => !p.required );

            if ( !extraSchemasOptional ) {
                // TODO Improve error message by pointing out what parameters are missing
                throw new Error( `Missing required parameters.` )
            }
        }

        if ( parametersSchema.length < parameters.length ) {
            const lastParameterVariadic = parametersSchema.length > 0 && parametersSchema[ parametersSchema.length - 1 ].variadic;

            if ( !lastParameterVariadic ) {
                throw new Error( `The tool only accepts ${ parametersSchema.length } parameters, but ${ parameters.length } were given.` );
            }
        }

        const pl = parameters.length;
        const sl = parametersSchema.length;

        for ( let i = 0; i < parameters.length; i++ ) {
            if ( pl > i && sl > i ) {
                parametersSchema[ i ].receive( options, true, parameters[ i ] );
            } else if ( pl > i ) {
                parametersSchema[ sl - 1 ].receive( options, true, parameters[ i ] );
            }
        }

        // If some optional parameters are not filled, we give the parameter the opportunity to fill some default value
        for ( let i = parameters.length; i < parametersSchema.length; i++ ) {
            parametersSchema[ i ].receive( options, false, null );
        }

        for ( let option of this.getOptions() ) {
            option.receive( options, option.name in parsed, parsed[ option.name ] );
        }

        return options;
    }
    
    abstract run ( options : O );
}

export class TestTool extends Tool {
    getParameters () {
        return [
            new ToolOption( 'name' ).setRequired( true ),
            new ToolOption( 'optional' ).setType( ToolValueType.Number ).setVariadic()
        ]
    }

    getOptions () {
        return [
            new ToolOption( 'id' )
        ];
    }

    run(  options : any ) {
        this.log( 'Running test', options );
    }
}