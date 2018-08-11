import * as got from 'got';

export async function remoteFileSize ( url : string ) : Promise<number> {
    const response = await got( url );

    if ( response.headers[ 'content-length' ] ) {
        return +response.headers[ 'content-length' ];
    }

    return null;
}