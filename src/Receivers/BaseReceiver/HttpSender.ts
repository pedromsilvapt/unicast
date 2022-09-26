import { IMediaReceiver } from "./IMediaReceiver";
import { Request, Response, Next } from "restify";
import { MediaStream } from "../../MediaProviders/MediaStreams/MediaStream";
import { SubtitlesMediaStream } from '../../MediaProviders/MediaStreams/SubtitlesStream';
import { serveMedia } from "../../ES2017/HttpServeMedia";
import { Logger } from 'clui-logger';

export class HttpSender {
    readonly receiver : IMediaReceiver;

    readonly logger : Logger;

    constructor ( receiver : IMediaReceiver ) {
        this.receiver = receiver;

        this.receiver.server.http.get( this.getUrlPattern(), this.serve.bind( this ) );

        this.logger = this.receiver.server.logger.service( `${ this.receiver.server.name }/sender/${ this.receiver.name }` );
    }

    host () : string {
        return this.receiver.server.getUrl();
    }

    getUrlFor ( session : string, stream : string ) : string {
        return `/media/send/${ encodeURIComponent( this.receiver.type ) }/${ encodeURIComponent( this.receiver.name ) }/session/${ session }/stream/${ stream }`;
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
            const { streams, options } = await this.receiver.sessions.get( req.params.session );

            options.subtitlesOffset

            const stream = await this.getStream( streams, req.params.stream, req.query );

            if ( SubtitlesMediaStream.is( stream ) ) {
                if ( options.subtitlesOffset != null ) {

                } else if ( stream.encoding == null ) {
                    await stream.autoDetectEncoding();
                }
            }


            let mime = SubtitlesMediaStream.is( stream )
                ? stream.mime + ';charset=' + stream.encoding
                : stream.mime;

            let reader = serveMedia( req, res, mime, stream.size, ( range ) => stream.reader( range ) );

            reader.on( 'error', err => {
                this.logger.error( `Serving stream type ${ stream.type.toUpperCase() } "${ stream.id }": ${ err.message + err.stackTrace }`, err );

                if ( reader ) {
                    stream.close( reader );
                }
            } );

            if ( reader ) {
                req.on( 'close', () => stream.close( reader ) );
            }

            next();
        } catch ( error ) {
           this.logger.error( `Fetching stream type "${ req.params.stream }": ${ error.message + error.stack }`, error );

           res.send( 500, { error: true } );

           next();
        }
    }
}
