import { BaseController, Route } from "../BaseController";
import { Response, Request } from "restify";
import { ResourceNotFoundError } from "restify-errors";

export class TasksController extends BaseController {
    @Route( 'get', '/' )
    async list ( req : Request, res : Response ) {
        let tasks = Array.from( this.server.tasks.tasks.values() );

        if ( req.query.state ) {
            tasks = tasks.filter( task => task.state == req.query.state );
        }

        if ( req.query.type ) {
            tasks = tasks.filter( task => task.getMetadata().type == req.query.type );
        }

        const response = tasks.map( t => t.toJSON() );

        if ( 'metricsHistory' in req.query && req.query.metricsHistory != 'true' ) {
            response.forEach( task => {
                if ( task.metrics instanceof Array ) {
                    task.metrics.forEach( metric => delete metric.points );
                }
            } );
        }
        
        return response;
    }

    @Route( 'get', '/:id' )
    async get ( req : Request, res : Response ) {
        if ( !this.server.tasks.has( req.params.id ) ) {
            throw new ResourceNotFoundError( `Could not find task with id "${ req.params.id }".` );
        }

        const task = this.server.tasks.get( req.params.id ).toJSON();

        if ( 'metricsHistory' in req.query && req.query.metricsHistory != 'true' ) {
            if ( task.metrics instanceof Array ) {
                task.metrics.forEach( metric => delete metric.points );
            }
        }

        return task;
    }

    @Route( 'post', '/:id/stop' )
    async stop ( req : Request, res : Response ) {
        if ( !this.server.tasks.has( req.params.id ) ) {
            throw new ResourceNotFoundError( `Could not find task with id "${ req.params.id }".` );
        }

        const task = this.server.tasks.get( req.params.id );

        task.setStateCancel();

        return task.toJSON();
    }
}