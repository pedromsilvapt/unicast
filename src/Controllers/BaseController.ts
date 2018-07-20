import { UnicastServer } from "../UnicastServer";
import { Router } from 'restify-router';
import { Request, Response, Next } from "restify";
import { Diagnostics, DiagnosticsService } from "../Diagnostics";

export type RoutesDeclarations = [ string[], string, string, RouteTransform, boolean ][];

export abstract class BaseController implements Annotated {
    annotations : Annotation[];

    name ?: string;

    readonly prefix : string;

    readonly server : UnicastServer;

    readonly diagnostics : DiagnosticsService;

    constructor ( server : UnicastServer, prefix ?: string ) {
        this.prefix = prefix;

        this.server = server;

        this.diagnostics = this.server.diagnostics.service( `${ this.server.name }/controller/${ this.name || this.constructor.name }` );
    }

    routes : RoutesDeclarations;
    
    childControllers : BaseController[];

    router ( prefix : boolean = true ) {
        const router = new Router();

        if ( this.routes ) {
            const firsts = this.routes.filter( r => !r[ 4 ] );
            const lasts = this.routes.filter( r => r[ 4 ] );

            const routes = [ ...firsts, ...lasts ];

            for ( let [ methods, url, action, transform ] of routes ) {
                for ( let method of methods ) {
                    router[ method ]( url, ( transform || handle )( this, action ) );
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
        this.router().applyRoutes( this.server.http );
    }
}

export function handle ( controller : { server : UnicastServer, diagnostics : DiagnosticsService }, method : string ) {
    return async function ( req : Request, res : Response, next : Next ) {
        const stopwatch = controller.server.diagnostics.stopwatch().resume();

        try {
            const result = await controller[ method ]( req, res );

            res.send( 200, result );
            
            next();
        } catch ( error ) {
            controller.diagnostics.error( error.message + error.stack, error );
            // controller.server.diagnostics.error( 'unicast/controller', error.message + error.stack, error );

            next( error );
        }

        controller.server.diagnostics.register( 'request', stopwatch.pause(), {
            url: req.url,
            controllerName: controller.constructor.name,
            controllerMethod : method,
            method: req.method
        } );
    };
}

export interface RouteTransform {
    ( controller : any, method : any ) : ( req : Request, res : Response, next : Next ) => void;
}

export function Route ( method : string | string[], path : string, handler : RouteTransform = null, appendLast : boolean = false ) {
    const methods : string[] = typeof method === 'string' ? [ method ] : method;

    return ( target : { routes: RoutesDeclarations }, propertyKey : string, descriptor : TypedPropertyDescriptor<any> ) => {
        target.routes = target.routes || [];

        target.routes.push( [ methods, path, propertyKey, handler, appendLast ] );

        return descriptor;
    };
}

export interface ControllerConstructor {
    new ( server : UnicastServer, path : string ) : BaseController;
}

export function Controller ( controller ?: ControllerConstructor, path ?: string ) {
    return ( target : BaseController, propertyKey : string ) => {
        // if ( controller ) {
        //     if ( !path ) {
        //         path = '/' + propertyKey;
        //     }

        //     target[ propertyKey ] = new controller( target.server, path );
        // }

        // target.childControllers = target.childControllers || [];

        // target.childControllers.push( target[ propertyKey ] );

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
    target.annotations = target.annotations || [];

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