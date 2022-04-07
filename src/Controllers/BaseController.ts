import { Route, UnicastServer } from "../UnicastServer";
import { Router } from 'restify-router';
import { Request, Response, Next } from "restify";
import { Logger } from 'clui-logger';
import { AccessCard, IpIdentity, ScopeResource } from '../AccessControl';
import { InvalidArgumentError, InvalidCredentialsError  } from 'restify-errors';
import * as schema from '@gallant/schema';

export type RoutesDeclarations = { 
    methods: string[], 
    path: string, 
    propertyKey: string, 
    handler: RouteTransform, 
    appendLast: boolean,
    authScope: string,
    querySchema?: schema.Type,
    bodySchema?: schema.Type,
    description?: string;
}[];

export abstract class BaseController implements Annotated {
    annotations : Annotation[];

    name ?: string;

    readonly prefix : string;

    readonly server : UnicastServer;

    readonly logger : Logger;

    constructor ( server : UnicastServer, prefix ?: string ) {
        this.prefix = prefix;

        this.server = server;

        this.logger = this.server.logger.service( `${ this.server.name }/controller/${ this.name || this.constructor.name }` );
    }

    routes : RoutesDeclarations;
    
    childControllers : BaseController[];

    router ( prefix : boolean = true ) {
        const router = new Router();

        if ( this.routes ) {
            const firsts = this.routes.filter( r => !r[ 4 ] );
            const lasts = this.routes.filter( r => r[ 4 ] );

            const routes = [ ...firsts, ...lasts ];

            for ( let { methods, path, propertyKey, handler, authScope, ...route } of routes ) {
                for ( let method of methods ) {
                    if ( typeof( router[ method ] ) !== 'function' ) {
                        throw new Error( `Method ${ method } is not an HTTP verb.` );
                    }

                    router[ method ](
                        { 
                            path,
                            querySchema: route.querySchema,
                            bodySchema: route.bodySchema,
                            description: route.description,
                        },
                        AuthenticationMiddleware( this, authScope ),
                        SchemaMiddleware( this, route.querySchema, route.bodySchema ),
                        ( handler || JsonResponse )( this, propertyKey )
                    );
                }
            }
        }
        
        this.childControllers = this.childControllers || [];

        for ( let ann of annotations<ControllerAnnotation>( this, Controller ) ) {
            if ( !this[ ann.propertyKey ] ) {
                this[ ann.propertyKey ] = new ann.controller( this.server, ann.path );
            }

            if ( !this.childControllers.includes( this[ ann.propertyKey ] ) ) {
                this.childControllers.push( this[ ann.propertyKey ] );
            }
        }

        if ( this.childControllers ) {
            for ( let controller of this.childControllers ) {
                router.add( controller.prefix, controller.router( false ) );
            }
        }

        if ( prefix && this.prefix ) {
            const master = new Router();

            master.add( this.prefix, router );

            return master;
        }

        return router;
    }

    install () {
        this.router().applyRoutes( this.server.http as any );
    }
}

export function AuthenticationMiddleware ( controller : { server : UnicastServer, logger : Logger }, authScope : string ) {
    return async function ( req : Request, res : Response, next : Next ) {
        const ip = req.connection.remoteAddress;

        req.identity =  new AccessCard( [ new IpIdentity( ip ) ] );

        if ( controller.server.accessControl.authenticate( req.identity, new ScopeResource( authScope ) ) ) {
            return next();
        } else {
            return next( new InvalidCredentialsError( "IP Address " + ip + " not atuhorized for scope: " + authScope ) );
        }
    };
}

export function SchemaMiddleware ( controller : { server : UnicastServer, logger : Logger }, querySchema : schema.Type, bodySchema : schema.Type ) {
    return async function ( req : Request, res : Response, next : Next ) {
        try {
            if ( querySchema != null ) {
                const errors = querySchema.validate( req.query );
    
                if ( errors != null ) {
                    const errorMessage = schema.errorsToString( schema.ValidationError.prefix( errors, 'query' ) );

                    return next( new InvalidArgumentError( errorMessage ) );
                }
            }
    
            if ( bodySchema != null ) {
                const errors = bodySchema.validate( req.body );
    
                if ( errors != null ) {
                    const errorMessage = schema.errorsToString( schema.ValidationError.prefix( errors, 'body' ) );

                    return next( new InvalidArgumentError( errorMessage ) );
                }
            }
        } catch ( error ) {
            return next( new InvalidArgumentError( error ) );
        }

        return next();
    };
}

export function JsonResponse ( controller : { server : UnicastServer, logger : Logger }, method : string ) {
    return async function ( req : Request, res : Response, next : Next ) {
        try {
            const result = await controller[ method ]( req, res );

            res.send( 200, result );
            
            next();
        } catch ( error ) {
            const key = controller.logger.prefix + '.' + method;

            const message = error.message + ( error.stack ? ( '\n' + error.stack ) : '' );
            
            controller.server.logger.error( key, message, error );

            next( error );
        }
    };
}

export function BinaryResponse ( controller : any, method : any ) {
    return async function ( req : Request, res : Response, next : Next ) {
        try {
            let file : FileInfo = await controller[ method ]( req, res );

            if ( file ) {
                res.statusCode = 200;
                
                res.set( 'Content-Type', file.mime || 'application/octet-stream' );

                if ( typeof file.length !== 'number' && !file.length ) {
                    res.set( 'Content-Length', '' + file.length );
                }
                
                ( res as any ).writeHead( 200 );

                if ( Buffer.isBuffer( file.data ) ) {
                    res.write( file.data );
                } else {
                    file.data.pipe( res );
                }
            }

            next();
        } catch ( error ) {
            console.log( error );
            next( error );
        }
    }
}

export interface FileInfo {
    mime ?: string;
    length ?: number;
    data : NodeJS.ReadableStream | Buffer;
}

export interface RouteTransform {
    ( controller : any, method : any ) : ( req : Request, res : Response, next : Next ) => void;
}

export function Route ( method : string | string[], path : string, handler : RouteTransform = null, appendLast : boolean = false ) {
    const methods : string[] = typeof method === 'string' ? [ method ] : method;

    return ( target : { routes: RoutesDeclarations }, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        if ( target.routes && !target.hasOwnProperty( 'routes' ) ) {
            target.routes = [ ...target.routes ];
        } else if ( !target.routes ) {
            target.routes = [];
        }

        target.routes = target.routes || [];

        let authScope = 'read';

        if ( methods.includes( 'post' ) 
          || methods.includes( 'put' ) 
          || methods.includes( 'patch' ) 
          || methods.includes( 'delete' ) ) {
            authScope = 'write';
        }

        target.routes.push( { 
            methods, path, propertyKey, handler, appendLast, authScope 
        } );

        return descriptor;
    };
}

export function AuthScope ( scope : string ) {
    return ( target : { routes: RoutesDeclarations }, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        const route = target.routes.find( ( { propertyKey: p } ) => propertyKey == p );

        if ( route == null ) {
            throw new Error( `Could not find a route defined to set the auth scope of: "${ propertyKey }"` );
        }

        route.authScope = scope;

        return descriptor;
    };
}

export function ValidateBody ( schemaType : schema.Type );
export function ValidateBody ( schemaType : string, options?: schema.AstOptions );
export function ValidateBody ( schemaType : schema.Type | string, options?: schema.AstOptions ) {
    return ( target : { routes: RoutesDeclarations }, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        const route = target.routes.find( ( { propertyKey: p } ) => propertyKey == p );

        if ( route == null ) {
            throw new Error( `Could not find a route defined to set the body schema of: "${ propertyKey }"` );
        }
        
        if ( typeof schemaType === 'string' ) {
            if ( options == null ) {
                options = schema.createDefaultOptions( {
                    defaultNumberStrict: false,
                    defaultBooleanStrict: false,
                } );
            } else {
                options.defaultNumberStrict = false;
                options.defaultBooleanStrict = false;
            }

            schemaType = schema.parse( schemaType, options );
        }

        route.bodySchema = schemaType;

        return descriptor;
    };
}

export function ValidateQuery ( schemaType : schema.Type );
export function ValidateQuery ( schemaType : string, options?: schema.AstOptions );
export function ValidateQuery ( schemaType : schema.Type | string, options?: schema.AstOptions ) {
    return ( target : { routes: RoutesDeclarations }, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        const route = target.routes.find( ( { propertyKey: p } ) => propertyKey == p );

        if ( route == null ) {
            throw new Error( `Could not find a route defined to set the body schema of: "${ propertyKey }"` );
        }

        if ( typeof schemaType === 'string' ) {
            if ( options == null ) {
                options = schema.createDefaultOptions( {
                    defaultNumberStrict: false,
                    defaultBooleanStrict: false,
                } );
            } else {
                options.defaultNumberStrict = false;
                options.defaultBooleanStrict = false;
            }

            schemaType = schema.parse( schemaType, options );
        }

        route.querySchema = schemaType;

        return descriptor;
    };
}

export interface ControllerConstructor {
    new ( server : UnicastServer, path : string ) : BaseController;
}

export function Controller ( controller ?: ControllerConstructor, path ?: string ) {
    return ( target : BaseController, propertyKey : string ) => {
        addAnnotation( target, Controller, {
            propertyKey,
            controller,
            path
        } );
    }
}

export function annotations<A extends Annotation> ( holder : Annotated, type : any ) : A[] {
    return ( holder.annotations || [] ).filter( ann => ann.type === type ) as A[];
}

export function addAnnotation ( target : Annotated, type : any, annotation : any ) : void {
    if ( target.annotations && !target.hasOwnProperty( 'annotations' ) ) {
        target.annotations = [ ...target.annotations ];
    } else if ( !target.annotations ) {
        target.annotations = [];
    }

    target.annotations.push( {
        type, ...annotation
    } );
}

const annotationsSymbol = Symbol();

export interface Annotated {
    annotations : Annotation[];
}

export interface Annotation {
    type : any;
}

export interface ControllerAnnotation extends Annotation {
    propertyKey : string;
    controller ?: ControllerConstructor;
    path ?: string;
}
