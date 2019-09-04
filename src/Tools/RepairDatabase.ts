import { Tool, ToolOption, ToolValueType } from "./Tool";
import { Stopwatch } from '../BackgroundTask';

interface RepairDatabaseOptions {
    
}

export class RepairDatabaseTool extends Tool<RepairDatabaseOptions> {
    async run ( options : RepairDatabaseOptions ) {
        await this.server.database.install();

        const stopwatch = new Stopwatch().resume();

        this.logger.info( 'starting repair' );

        await this.server.database.repair();

        stopwatch.pause();
        
        this.logger.info( `completed in + ${ stopwatch.readHumanized() }` );
    }
}
