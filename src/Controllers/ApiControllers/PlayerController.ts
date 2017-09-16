import { BaseController, RoutesDeclarations, Controller, Route } from "../BaseController";
import { Request, Response } from "restify";
import { PlaylistsController } from "./PlaylistsController";
import { MediaSourceDetails } from "../../MediaProviders/MediaSource";
import { InvalidArgumentError } from 'restify-errors';

export class InvalidDeviceArgumentError extends InvalidArgumentError {
    constructor ( device : string ) {
        super( `Could not find a device named "${ device }".` );
    }
}

export class PlayerController extends BaseController {
    @Controller( PlaylistsController, '/:device/playlists' )
    playlists : PlaylistsController;

    @Route( 'get', '/list' )
    async list ( req : Request, res : Response ) {
        return Array.from( this.server.receivers )
            .map( receiver => receiver.toJSON() );
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

    @Route( 'get', '/:device/playtest' )
    async playtest ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.play( 'bd0dbdbc-096a-4217-bfaa-2060bb834ce0' );
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
    
            const session = await device.sessions.register( device.name, record );

            return device.play( session );
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
    
            const session = await device.sessions.register( device.name, record );

            return device.play( session );
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/pause' )
    async pause ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.pause();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/resume' )
    async resume ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.resume();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/stop' )
    async stop ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.stop();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/disconnect' )
    async disconnect ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.disconnect();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( [ 'get', 'post' ], '/:device/reconnect' )
    async reconnect ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.reconnect();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }

    @Route( 'get', '/:device/status' )
    async status ( req : Request, res : Response ) {
        const device = this.server.receivers.get( req.params.device );

        if ( device ) {
            return device.status();
        } else {
            throw new InvalidDeviceArgumentError( req.params.device );
        }
    }
}