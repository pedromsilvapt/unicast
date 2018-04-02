import { Request, Response } from "restify";
import * as rangeParser      from 'range-parser';

export function serveMedia ( req : Request, res : Response, mime : string, size : number, openStream : ( range : any ) => NodeJS.ReadableStream ) : NodeJS.ReadableStream {
    res.set( 'Content-Type', mime );
    
    const range = typeof size === 'number' && req.header( 'range' ) ? rangeParser( size, req.header( 'range' ) )[ 0 ] : null;

    let reader = null;

    if ( range ) {
        res.set( 'Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size );
        res.set( 'Accept-Ranges', 'bytes' );
        res.set( 'Content-Length', '' + ( ( range.end - range.start ) + 1 ) );
        
        ( res as any ).writeHead( 206, res.headers() );
        
        reader = openStream( range )
        
        reader.pipe( res );
    } else {
        if ( size ) {
            res.set( 'Content-Length', '' + size );
        }

        ( res as any ).writeHead( 200, res.headers() );
        
        reader = openStream( {} );
        
        reader.pipe( res );
    }

    return reader;
}