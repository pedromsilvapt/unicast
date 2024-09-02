#!/usr/bin/env node
import { Keyboard } from './Keyboard';
import * as argvSetEnv from 'argv-set-env';

const releaseFlag = process.argv.indexOf( '--release' );

if ( releaseFlag >= 0 ) {
    process.argv[ releaseFlag ] = '--env-NODE_ENV=release';
}

argvSetEnv( { prefix: '--env' } );

import { server } from './index';

let closed = false;

Keyboard.setup( async () => {
    if ( !closed ) {
        closed = true;

        await server.close( 15 * 1000 );
    }

    Keyboard.close();

    process.exit();
} );
