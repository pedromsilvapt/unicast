import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { MediaSync } from "../../../MediaSync";
import { BackgroundTask } from "../../../BackgroundTask";
import { MediaKind } from "../../../MediaRecord";

export class ProvidersController extends BaseController {
    @Route( ['get', 'post'], '/sync' )
    async sync ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const kinds : MediaKind[] = req.query.kinds || null;
        
        const database = this.server.database;
        
        const sync = new MediaSync( this.server.media, database, this.server.repositories, this.server.diagnostics );

        const [ task, done ] = BackgroundTask.fromPromise( task => sync.run( task, { kinds, cleanMissing: false, dryRun: req.query.dryRun === 'true' } ) );
        
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
        
        const sync = new MediaSync( this.server.media, database, this.server.repositories, this.server.diagnostics );

        const [ task, done ] = BackgroundTask.fromPromise( task => sync.run( task, { kinds, cleanMissing: true, dryRun: req.query.dryRun === 'true' } ) );
        
        this.server.tasks.register( task );

        if ( req.query.wait === 'true' ) {
            await done;
        }

        return task;
    }        
}
