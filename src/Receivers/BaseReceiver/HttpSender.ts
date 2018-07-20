import { IMediaReceiver } from "./IMediaReceiver";
import { Request, Response, Next } from "restify";
import { MediaStreamType, MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { serveMedia } from "../../ES2017/HttpServeMedia";
import { DiagnosticsService } from "../../Diagnostics";

export class HttpSender {
    readonly receiver : IMediaReceiver;

    readonly diagnostics : DiagnosticsService;

    constructor ( receiver : IMediaReceiver ) {
        this.receiver = receiver;

        this.receiver.server.http.get( this.getUrlPattern(), this.serve.bind( this ) );

        this.diagnostics = this.receiver.server.diagnostics.service( `${ this.receiver.server.name }/sender/${ this.receiver.name }` );
    }

    host () : string {
        return this.receiver.server.getUrl();
    }

    getUrlFor ( session : string, stream : string ) : string {
        return `/media/send/${ this.receiver.type }/${ this.receiver.name }/session/${ session }/stream/${ stream }`;
    }

    getUrlPattern () : string {
        return this.getUrlFor( ':session', ':stream' );
    }

    async getStream ( streams : MediaStream[], id : string, options : any = null ) : Promise<MediaStream> {
        const stream = streams.find( stream => stream.id === id );

        if ( stream.isContainer ) {
            return ( await stream.getInnerStream( options ) ) || stream;
        }

        return stream;
    }

    async serve ( req : Request, res : Response, next : Next ) : Promise<void> {
        try {
            const [ streams, record, options ] = await this.receiver.sessions.get( req.params.session );
    
            const stream = await this.getStream( streams, req.params.stream, req.query );
            
            let mime = stream.type === MediaStreamType.Subtitles
                ? stream.mime + ';charset=utf-8'
                : stream.mime;
            
            let reader = serveMedia( req, res, mime, stream.size, ( range ) => stream.reader( range ) );
            
            reader.on( 'error', err => {
                this.diagnostics.error( `Serving stream type ${ stream.type.toUpperCase() } "${ stream.id }": ${ err.message + err.stack }`, err );

                if ( reader ) {
                    stream.close( reader );
                }
            } );

            if ( reader ) {
                req.on( 'close', () => stream.close( reader ) );
            }

            next();
        } catch ( error ) {
           this.diagnostics.error( `Fetching stream type "${ req.params.stream }": ${ error.message + error.stack }`, error );

           res.send( 500, { error: true } );

           next();
        }
    }
}