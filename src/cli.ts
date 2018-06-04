import { Keyboard } from './Keyboard';
import * as argvSetEnv from 'argv-set-env';

argvSetEnv( { prefix: '--env' } );

import { server } from './index';

Keyboard.setup( async () => {
    await server.close( 15 * 1000 ),

    Keyboard.close();

    process.exit();
} );