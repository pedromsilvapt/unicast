import { IMediaReceiver } from "./IMediaReceiver";
import { Request, Response, Next } from "restify";
import { MediaStreamType, MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import * as rangeParser      from 'range-parser';

export class HttpSender {
    readonly receiver : IMediaReceiver;

    constructor ( receiver : IMediaReceiver ) {
        this.receiver = receiver;

        this.receiver.server.http.get( this.getUrlPattern(), this.serve.bind( this ) );
    }

    async host () : Promise<string> {
        return this.receiver.server.getUrl();
    }

    getUrlFor ( session : string, stream : string ) : string {
        return `/media/send/${ this.receiver.type }/${ this.receiver.name }/session/${ session }/stream/${ stream }`;
    }

    getUrlPattern () : string {
        return this.getUrlFor( ':session', ':stream' );
    }

    async getStream ( streams : MediaStream[], id : string ) : Promise<MediaStream> {
        return streams.find( stream => stream.id === id );
    }

    async serve ( req : Request, res : Response, next : Next ) : Promise<void> {
        try {
            const [ streams, record, options ] = await this.receiver.sessions.get( req.params.session );
    
            const stream = await this.getStream( streams, req.params.stream );
    
            res.set( 'Access-Control-Allow-Origin', '*' );
            
            if ( stream.type === MediaStreamType.Subtitles ) {
                res.set( 'Content-Type', stream.mime + ';charset=utf-8' );
            } else {
                res.set( 'Content-Type', stream.mime );
            }
    
            const range = stream.size && req.header( 'range' ) ? rangeParser( stream.size, req.header( 'range' ) )[ 0 ] : null;

            if ( range ) {
                res.set( 'Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + stream.size );
                res.set( 'Accept-Ranges', 'bytes' );
                res.set( 'Content-Length', '' + ( ( range.end - range.start ) + 1 ) );
                
                ( res as any ).writeHead( 206, res.headers() );
    
                stream.reader( range ).pipe( res );
            } else if ( stream.size ) {
                res.set( 'Content-Length', '' + stream.size );
    
                ( res as any ).writeHead( 200, res.headers() );
                
                stream.reader().pipe( res );
            }
        
            next();
        } catch ( error ) {
           console.error( error ) ;

           res.send( 0, { error: true } );

           next();
        }
    }
}