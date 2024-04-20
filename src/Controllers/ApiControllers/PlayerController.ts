import { BaseController, Controller, Route, BinaryResponse, FileInfo } from "../BaseController";
import { Request, Response } from "restify";
import { PlaylistsController } from "./PlaylistsController";
import { MediaSourceDetails } from "../../MediaProviders/MediaSource";
import { InvalidArgumentError, HttpError, NotFoundError } from 'restify-errors';
import { MediaPlayOptions, ReceiverStatus } from "../../Receivers/BaseReceiver/IMediaReceiver";
import { MediaRecord, isPlayableRecord } from "../../MediaRecord";
import * as Case from 'case';
import { MediaStreamSelectors } from '../../MediaProviders/MediaStreams/MediaStreamSelectors';
import * as mime from 'mime';
import { MediaPreview } from '../../MediaPreview';
import * as sortBy from 'sort-by';
import { EntityResource } from '../../AccessControl';

export class InvalidDeviceArgumentError extends InvalidArgumentError {
    constructor ( device : string ) {
        super( `Could not find a device named "${ device }".` );
    }
}

export class NoMediaFound extends HttpError {
    constructor () {
        super( {
            statusCode: 412,
            message: `No media available to fulfill the request.`,
            code: 'ENOMEDIA'
        } );
    }
}

export class PlayerController extends BaseController {
    @Controller( PlaylistsController, '/:device/playlists' )
    playlists : PlaylistsController;

    @Route( 'get', '/list' )
    async list ( req : Request, res : Response ) {
        return Array.from( this.server.receivers )
            .map( receiver => receiver.toJSON() )
            .filter( receiver => this.server.accessControl.authenticate( req.identity, new EntityResource( 'receiver', receiver ) ) )
            .sort( sortBy( 'type', 'name' ) );
    }

    @Route( 'get', '/:device' )
    async get ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.toJSON();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/play/next' )
    async playNextMedia ( req : Request, res : Response ) : Promise<ReceiverStatus> {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const next = await device.sessions.getNext( device.sessions.current, req.query.strategy || 'auto' );

            const [ record, options ] = next.orElseThrow( () => new NoMediaFound() );

            const session = await device.sessions.register( record, options );

            return this.preprocessStatus( req, await device.play( session ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/play/previous' )
    async playPreviousMedia ( req : Request, res : Response ) : Promise<ReceiverStatus> {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const next = await device.sessions.getPrevious( device.sessions.current, req.query.strategy || 'auto' );

            const [ record, options ] = next.orElseThrow( () => new NoMediaFound() );

            const session = await device.sessions.register( record, options );

            return this.preprocessStatus( req, await device.play( session ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'get', '/:device/preview/next' )
    async nextMedia ( req : Request, res : Response ) : Promise<{ record: MediaRecord, options : MediaPlayOptions }> {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const next = await device.sessions.getNext( device.sessions.current, req.query.strategy || 'auto' );

            if ( next.isPresent() ) {
                const [ record, options ] = next.get();

                return { record, options };
            } else {
                return { record: null, options: null };
            }
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'get', '/:device/preview/previous' )
    async previousMedia ( req : Request, res : Response ) : Promise<{ record: MediaRecord, options : MediaPlayOptions }> {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const previous = await device.sessions.getPrevious( device.sessions.current, req.query.strategy || 'auto' );

            if ( previous.isPresent() ) {
                const [ record, options ] = previous.get();

                return { record, options };
            } else {
                return { record: null, options: null };
            }
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/play/media/:kind/:id' )
    async playMedia ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const { kind, id } = req.params;

            const record = await this.server.media.get( kind, id );

            if ( record == null ) {
                throw new NoMediaFound();
            }

            const { playlistId, playlistPosition, startTime, autostart, subtitlesOffset, transcoding } = req.body;

            const options : MediaPlayOptions = playlistId ? { playlistId, playlistPosition } : {};

            if ( startTime ) {
                options.startTime = parseFloat( startTime );
            }

            if ( autostart ) {
                options.autostart = autostart !== 'false';
            }

            if ( subtitlesOffset ) {
                options.subtitlesOffset = +subtitlesOffset;
            }

            if ( transcoding ) {
                options.transcoding = transcoding;
            }

            const session = await device.sessions.register( record, options );

            return this.preprocessStatus( req, await device.play( session ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/play' )
    async playSources ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const sources : MediaSourceDetails[] = req.body.sources;

            const record = await this.server.media.createFromSources( sources );

            if ( record == null ) {
                throw new NoMediaFound();
            }

            const session = await device.sessions.register( record );

            return this.preprocessStatus( req, await device.play( session ) );

        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/pause' )
    async pause ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.pause() );

        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/resume' )
    async resume ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.resume() );

        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/stop' )
    async stop ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.stop() );

        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/disconnect' )
    async disconnect ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return { success: await device.disconnect() };
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/reconnect' )
    async reconnect ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return { success: await device.reconnect() };
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/turnoff' )
    async turnoff ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.turnoff() );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    protected async preprocessStatus ( req, status : ReceiverStatus ) : Promise<ReceiverStatus> {
        if ( status && status.media && status.media.record ) {
            const url = this.server.getMatchingUrl( req );

            ( status.media.record as any ).cachedArtwork = this.server.artwork.getCachedObject( url, status.media.record.kind, status.media.record.id, status.media.record.art );
        }

        return status;
    }

    @Route( 'get', '/:device/status' )
    async status ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.status() );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/seek/:time' )
    async seek ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.seek( +req.params.time ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/seek-to/:time' )
    async seekTo ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.seekTo( +req.params.time ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/mute' )
    async mute ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.mute() );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/unmute' )
    async unmute ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return this.preprocessStatus( req, await device.unmute() );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/volume/:volume' )
    async setVolume ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const volume : number = parseFloat( req.params.volume );

            return this.preprocessStatus( req, await device.setVolume( volume ) );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'post', '/:device/subtitles-size/:size' )
    async setSubtitlesSize ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const size : number = parseFloat( req.params.size );

            const status = await device.callCommand<ReceiverStatus>( 'changeSubtitlesSize', [ size ] );

            return this.preprocessStatus( req, status );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/command/:command' )
    async command ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const args = req.query.args || req.body.args || [];

            const status = await device.callCommand<ReceiverStatus>( Case.camel( req.params.command ), args );

            return this.preprocessStatus( req, status );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'get', '/:device/preview/:kind/:id/:time', BinaryResponse )
    async preview ( req : Request, res : Response ) : Promise<FileInfo> {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            const media = await this.server.media.get( req.params.kind, req.params.id );

            if ( !isPlayableRecord( media ) ) {
                throw new InvalidArgumentError( 'Media is not playable.' );
            }

            const streams = await this.server.providers.streams( media.sources );

            const video = MediaStreamSelectors.firstVideo( streams );

            if ( video == null ) {
                throw new NotFoundError( 'Media item does not contain a video source.' );
            }

            const time = +req.params.time;

            if ( isNaN( time ) ) {
                throw new InvalidArgumentError( 'Time is not a number.' );
            }

            const preview = new MediaPreview( this.server, media, video, time );

            if ( 'width' in req.query ) {
                preview.width = +req.query.width;
            }

            if ( 'height' in req.query ) {
                preview.height = +req.query.height;
            }

            return {
                mime: mime.lookup( '.' + preview.getFileExtension() ),
                data: preview.generate()
            };
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }
}
