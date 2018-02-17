import { BaseController, RoutesDeclarations, Controller, Route } from "../../BaseController";
import { Request, Response, Next } from "restify";
import * as path from 'path';
import * as fs from 'mz/fs';
import { MediaSync } from "../../../MediaSync";
import { BackgroundTask } from "../../../BackgroundTask";
import { MediaKind } from "../../../MediaRecord";

export class ProvidersController extends BaseController {
    @Route( ['get', 'post'], '/sync' )
    async sync ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const kinds : MediaKind[] = req.query.kinds || null;
        
        const database = this.server.database;
        
        const sync = new MediaSync( database, this.server.providers.repositories );

        const [ task, done ] = BackgroundTask.fromPromise( task => sync.sync( task, kinds ) );
        
        this.server.tasks.register( task );

        if ( req.query.wait === 'true' ) {
            await done;
        }

        return task;
    }

    @Route( 'get', '/sync/:id' )
    async get ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const id : string = req.params.id;

        return this.server.tasks.get( id );
    }

    @Route( [ 'post', 'get' ], '/clean' )
    async clean ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const kinds : MediaKind[] = req.query.kinds || null;
        
        const database = this.server.database;
        
        const sync = new MediaSync( database, this.server.providers.repositories );

        const [ task, done ] = BackgroundTask.fromPromise( task => sync.clean( task, kinds ) );

        this.server.tasks.register( task );

        if ( req.query.wait === 'true' ) {
            await done;
        }

        return task;
    }        
}
