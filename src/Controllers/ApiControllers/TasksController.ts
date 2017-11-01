import { BaseController, Route } from "../BaseController";
import { Response, Request } from "restify";
import { ResourceNotFoundError } from "restify-errors";

export class TasksController extends BaseController {
    @Route( 'get', '/' )
    async list ( req : Request, res : Response ) {
        return Array.from( this.server.tasks.tasks.values() ).map( t => t.toJSON() );
    }

    @Route( 'get', '/:id' )
    async get ( req : Request, res : Response ) {
        if ( !this.server.tasks.has( req.params.id ) ) {
            throw new ResourceNotFoundError( `Could not find task with id "${ req.params.id }".` );
        }

        return this.server.tasks.get( req.params.id ).toJSON();
    }
}