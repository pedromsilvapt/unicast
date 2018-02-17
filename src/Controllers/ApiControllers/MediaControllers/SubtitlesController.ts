import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { ISubtitle } from "../../../Subtitles/Providers/ISubtitlesProvider";
import { ILocalSubtitle } from "../../../Subtitles/SubtitlesManager";
import { MpvController } from "../../../Subtitles/Validate/MPV/Controller";
import { MediaKind, PlayableMediaRecord } from "../../../MediaRecord";
import { MediaStreamType } from "../../../MediaProviders/MediaStreams/MediaStream";
import { FileSystemVideoMediaStream } from "../../../MediaProviders/FileSystemMediaProvider/MediaStreams/FileSystemVideoStream";
import { MediaRecord } from "../../../Subtitles/Providers/OpenSubtitles/OpenSubtitlesProvider";
import { Semaphore } from "await-semaphore";

export class SubtitlesController extends BaseController {
    protected validateSemaphore : Semaphore = new Semaphore( 1 );

    @Route( 'get', '/:kind/:id/local' )
    async listLocal ( req : Request, res : Response ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get( req.params.kind, req.params.id );

        return this.server.subtitles.list( media );
    }

    @Route( 'get', '/:kind/:id/remote' )
    async listRemote ( req : Request, res : Response ) : Promise<ISubtitle[]> {
        const media = await this.server.media.get( req.params.kind, req.params.id );
        
        return this.server.subtitles.providers.search( media, [ 'por' ] );
    }

    protected async validateSubtitle ( media : PlayableMediaRecord, subtitleFile : string ) {
        const subtitles = await this.server.subtitles.list( media );

        const streams = await this.server.providers.streams( media.sources );

        const video = streams.find( stream => stream.type === MediaStreamType.Video ) as FileSystemVideoMediaStream;
        
        const release = await this.validateSemaphore.acquire();

        const player = new MpvController( this.server );

        await player.play( video.file, subtitleFile );

        release();

        return { success: true };
    }

    @Route( 'get', '/:kind/:id/local/:sub/validate' )
    async validateLocal ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitles = await this.server.subtitles.list( media );

        const subtitle = subtitles.find( sub => sub.id === req.params.sub );

        const file = await this.server.storage.getRandomFile( 'validate-local-', 'srt', 'temp/subtitles' );
        
        await this.server.subtitles.storeLocalToFile( media, subtitle, file )        

        await this.validateSubtitle( media, file );
    }

    @Route( 'get', '/:kind/:id/remote/:sub/validate' )
    async validateRemote ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitles = await this.server.subtitles.providers.search( media, [ 'por' ] );

        const subtitle = subtitles.find( sub => sub.id === req.params.sub );

        const file = await this.server.storage.getRandomFile( 'validate-remote-', '.srt', 'temp/subtitles' );

        await this.server.subtitles.storeRemoteToFile( subtitle, file )
        
        await this.validateSubtitle( media, file );
    }

    @Route( 'post', '/:kind/:id' )
    async save ( req : Request ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get( req.params.kind, req.params.id );
        
        const body = typeof req.body === 'string' ? JSON.parse( req.body ) : req.body;

        const subtitle : ISubtitle = body.subtitle;

        await this.server.subtitles.store( media, subtitle )

        return this.server.subtitles.list( media );
    }

    @Route( 'del', '/:kind/:id/local/:sub' )
    async delete ( req : Request ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get( req.params.kind, req.params.id );
        
        const subtitle = await this.server.subtitles.get( media, req.params.sub );

        await this.server.subtitles.delete( media, subtitle );

        return this.server.subtitles.list( media );
    }
}