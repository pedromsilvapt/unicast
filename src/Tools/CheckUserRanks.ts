import { Tool, ToolOption, ToolValueType } from "./Tool";
import chalk from 'chalk';

enum ConsistencyLevel {
    Valid = 0,
    Fragmented = 1,
    Corrupted = 2,
}

const ConsistencyLevelData: Record<ConsistencyLevel, { label: string, visual: (str: string) => string }> = {
    [ConsistencyLevel.Valid]: { label: 'Valid', visual: chalk.green },
    [ConsistencyLevel.Fragmented]: { label: 'Fragmented', visual: chalk.yellow },
    [ConsistencyLevel.Corrupted]: { label: 'Corrupted', visual: chalk.red },
}

type ConsistencyReport = Record<"duplicates" | "holes" | "invalid", number[]>;

export interface CheckUserRanksOptions {
    
}

export class CheckUserRanksTool extends Tool<CheckUserRanksOptions> {
    getParameters () {
        return [];
    }

    getOptions () {
        return [];
    }

    protected getConsistencyLevel ( report: ConsistencyReport ) : ConsistencyLevel {
        if ( report.invalid.length > 0 || report.duplicates.length > 0 ) {
            return ConsistencyLevel.Corrupted;
        } else if ( report.holes.length > 0 ) {
            return ConsistencyLevel.Fragmented;
        } else {
            return ConsistencyLevel.Valid;
        }
    }
    
    async run ( options : CheckUserRanksOptions ) {
        await this.server.database.install();

        const { userRanks } = this.server.database.tables;

        const listIds = await userRanks.find( query => {
            return ( query as any ).distinct( { index: 'list' } );
        } ) as string[];
        
        for ( const id of listIds ) {
            const list = this.server.media.userRanks.getList( id );

            const consistency = await list.semaphore.read.use( () => list.checkConsistency() );

            const consistencyLevel = this.getConsistencyLevel( consistency );

            const consistencyLevelData = ConsistencyLevelData[ consistencyLevel ];

            this.log( '#' + id + ': ' + consistencyLevelData.visual( consistencyLevelData.label.toUpperCase() ) );

            if ( consistencyLevel !== ConsistencyLevel.Valid ) {
                if ( consistency.duplicates.length > 0 ) {
                    this.log( '\Duplicates: ' + consistency.duplicates.join( ', ' ) );
                }
                
                if ( consistency.holes.length > 0 ) {
                    this.log( '\Holes: ' + consistency.holes.join( ', ' ) );
                }

                if ( consistency.invalid.length > 0 ) {
                    this.log( '\tInvalid: ' + consistency.invalid.join( ', ' ) );
                }
            }
        }
    }
}