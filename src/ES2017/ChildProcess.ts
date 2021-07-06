import { ChildProcess } from 'mz/child_process';

export function waitForProcess ( process: ChildProcess ) {
    return new Promise<number>( ( resolve, reject ) => {
        if ( process == null ) {
            return reject( new Error( `Process cannot be null.` ) );
        }

        process.on( 'close', resolve );
        process.on( 'error', reject );
    } );
}