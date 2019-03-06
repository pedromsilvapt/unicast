import * as got from 'got';

export function httpPing ( url : string ) : Promise<boolean> {
    return got( url ).then( () => true, () => false );
}