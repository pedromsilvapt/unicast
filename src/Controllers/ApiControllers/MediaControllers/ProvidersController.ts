import { BaseController, Route, ValidateQuery } from "../../BaseController";
import { Request, Response } from "restify";
import { ArtworkAcceptanceMode, ArtworkPreservationMode, MediaSync, MediaSyncOptions, MediaSyncRepairMode, MediaSyncTask } from "../../../MediaSync";
import { BackgroundTask, Stopwatch } from "../../../BackgroundTask";
import { MediaKind } from "../../../MediaRecord";
import * as schema from '@gallant/schema';

export class ProvidersController extends BaseController {
    @ValidateQuery(`{
        kinds?: "movie" | "show" | "season" | "episode" | "custom";
        cleanMissing?: boolean;
        dryRun?: boolean;
        refetchExisting?: boolean;
        refetchIncomplete?: boolean;
        updateMoved?: boolean;
        cache?: {
            read?: boolean;
            write?: boolean;
        },
        repairMode?: 0 | 1 | 2;
        localArtworkPreservation?: 0 | 1 | 2 | 3;
        incomingArtworkAcceptance?: 0 | 1 | 2 | 3;
        refreshRecords?: {
            kind: "movie" | "show" | "season" | "episode" | "custom";
            id: string;
        }[];
    }`)
    @Route( ['get', 'post'], '/sync' )
    async sync ( req : Request, res : Response ) : Promise<BackgroundTask> {
        const kinds : MediaKind[] = req.query.kinds || null;

        const database = this.server.database;

        const sync = new MediaSync( this.server.media, database, this.server.repositories, this.server.scrapers, this.server.mediaTools, this.server.logger );

        const [ task, done ] = BackgroundTask.fromPromise( async task => {
            const options : Partial<MediaSyncOptions> = {
                kinds,
                cleanMissing: req.query.cleanMissing == 'true',
                dryRun: req.query.dryRun === 'true',
                refetchExisting: req.query.refetchExisting == 'true',
                refetchIncomplete: req.query.refetchIncomplete == 'true',
                updateMoved: req.query.updateMoved == 'true',
                cache: {
                    readCache: !req.query.cache || req.query.cache.read != 'false',
                    writeCache: !req.query.cache || req.query.cache.write != 'false'
                },
                autoFinishTask: false,
                repairMode: Number( req.query.repairMode ?? MediaSyncRepairMode.OnlyChanged ),
                localArtworkPreservation: Number( req.query.localArtworkPreservation ?? ArtworkPreservationMode.DiscardIfEmpty ),
                incomingArtworkAcceptance: Number( req.query.incomingArtworkAcceptance ?? ArtworkAcceptanceMode.WhenNotEmpty ),
                refreshRecords: req.query.refreshRecords,
            };

            this.server.logger.info( 'repositories/sync', 'starting sync with ' + JSON.stringify( options ) );

            const stopwatch = new Stopwatch().resume();

            await sync.run( task, options );

            stopwatch.mark( 'sync' );

            if ( !options.dryRun ) {
                this.server.logger.info( 'repositories/sync', 'starting repair' );

                await this.server.database.repair();
            }

            stopwatch.pause().mark( 'repair', 'sync' );

            this.server.logger.info( 'repositories/sync', `completed in + ${ stopwatch.readHumanized() } (sync = ${ stopwatch.readHumanized( 'sync' ) }, repair = ${ stopwatch.readHumanized( 'repair' ) })` );
        }, MediaSyncTask );

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

    @Route( [ 'post', 'get' ], '/repair' )
    async repair ( req : Request, res : Response ) : Promise<void> {
        const database = this.server.database;

        this.server.logger.info( 'repositories/sync', `starting repair` );

        const results = await database.repair();

        const tasks = Array.from( results.tasks.entries() ).map( ( [ name, sw ] ) => `${name} = ${ sw.readHumanized() }` ).join( ', ' );

        this.server.logger.info( 'repositories/sync', `completed repair in + ${ results.global.readHumanized() } (${ tasks })` );
    }
}
