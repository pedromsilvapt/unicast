import { Tool, ToolOption } from "./Tool";
import { Stopwatch } from '../BackgroundTask';

interface CloneDatabaseOptions {
    targetDb : string;
}

export class CloneDatabaseTool extends Tool<CloneDatabaseOptions> {
    getParameters () {
        return [ 
            new ToolOption( 'targetDb' ),
        ]
    }

    async run ( options : CloneDatabaseOptions ) {
        await this.server.database.install();

        if ( options.targetDb == null || options.targetDb.trim() == "" ) {
            this.logger.fatal(`Target DB name cannot be empty.`);
            return;
        }

        const stopwatch = new Stopwatch().resume();

        await this.server.database.clone( options.targetDb, this.logger.service( 'Clone' ) );

        stopwatch.pause();
    
        this.log( 'All tables exported', `(in ${ stopwatch.readHumanized() })` );
    }
}
