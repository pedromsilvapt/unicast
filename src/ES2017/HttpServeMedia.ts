import { Request, Response } from "restify";
import * as rangeParser      from 'range-parser';
import * as pump from 'pump';

export function serveMedia ( req : Request, res : Response, mime : string, size : number, openStream : ( range : any ) => NodeJS.ReadableStream ) : NodeJS.ReadableStream {
    res.set( 'Content-Type', mime );
    res.set( 'Accept-Ranges', 'bytes' );

    const range = typeof size === 'number' && req.header( 'range' ) ? rangeParser( size, req.header( 'range' ) )[ 0 ] : null;

    let reader = null;

    if ( range ) {
        res.set( 'Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size );
        res.set( 'Content-Length', '' + ( ( range.end - range.start ) + 1 ) );
        
        ( res as any ).writeHead( 206 );
        
        if ( req.method.toLowerCase() == 'head' ) {
            res.end();
        } else {
            reader = openStream( range )

            pump( reader, res );
        }
    } else {
        if ( size ) {
            res.set( 'Content-Length', '' + size );
        }

        ( res as any ).writeHead( 200 );

        if ( req.method.toLowerCase() == 'head' ) {
            res.end();
        } else {
            reader = openStream( {} );

            pump( reader, res );
        }
    }

    return reader;
}