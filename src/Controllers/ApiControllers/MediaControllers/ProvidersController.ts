import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { MediaSync, MediaSyncOptions } from "../../../MediaSync";
import { BackgroundTask, Stopwatch } from "../../../BackgroundTask";
import { MediaKind } from "../../../MediaRecord";

export class ProvidersController extends BaseController {
    @Route( ['get', 'post'], '/sync' )
    async sync ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const kinds : MediaKind[] = req.query.kinds || null;
        
        const database = this.server.database;
        
        const sync = new MediaSync( this.server.media, database, this.server.repositories, this.server.diagnostics );

        const [ task, done ] = BackgroundTask.fromPromise( async task => {
            const options : Partial<MediaSyncOptions> = { kinds, cleanMissing: false, dryRun: req.query.dryRun === 'true', refetchExisting: false };

            this.server.diagnostics.info( 'repositories/sync', 'starting sync with ' + JSON.stringify( options ) );

            const stopwatch = new Stopwatch().resume();

            await sync.run( task, options );

            stopwatch.mark( 'sync' );

            if ( !options.dryRun ) {
                await this.server.database.tables.shows.repair();

                await this.server.database.tables.movies.repair();
            }

            stopwatch.pause().mark( 'repair', 'sync' );

            this.server.diagnostics.info( 'repositories/sync', `completed in + ${ stopwatch.readHumanized() } (sync = ${ stopwatch.readHumanized( 'sync' ) }, repair = ${ stopwatch.readHumanized( 'repair' ) })` );
        } );
        
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
