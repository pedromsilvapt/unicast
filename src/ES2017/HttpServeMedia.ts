import { Request, Response } from "restify";
import * as rangeParser      from 'range-parser';
import * as pump from 'pump';

export function contentDisposition ( filename : string ) : string {
    // Plain `filename` must be printable ASCII inside a quoted string, so replace anything
    // outside that range (and the quote/backslash characters) with an underscore
    const fallback = filename.replace( /[^\x20-\x7e]|["\\]/g, '_' );

    // `filename*` is percent-encoded UTF-8. encodeURIComponent leaves ' ( ) * as they are,
    // but RFC 5987 does not allow them unencoded, so encode those manually
    const encoded = encodeURIComponent(filename)
        .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

    // Clients that understand `filename*` prefer it; older ones fall back to `filename`.
    // `inline` (rather than `attachment`) keeps browsers playing the media instead of downloading it
    return `inline; filename="${ fallback }"; filename*=UTF-8''${ encoded }`;
}

export function serveMedia ( req : Request, res : Response, mime : string, size : number, filename : string | null, openStream : ( range : any ) => NodeJS.ReadableStream ) : NodeJS.ReadableStream {
    res.set( 'Content-Type', mime );
    res.set( 'Accept-Ranges', 'bytes' );

    if ( filename ) {
        res.set( 'Content-Disposition', contentDisposition( filename ) );
    }

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
