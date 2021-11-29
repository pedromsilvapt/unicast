import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { ISubtitle } from "../../../Subtitles/Providers/ISubtitlesProvider";
import { ILocalSubtitle } from "../../../Subtitles/SubtitlesManager";
import { MpvController } from "../../../Subtitles/Validate/MPV/Controller";
import { MediaKind, PlayableMediaRecord, TvEpisodeMediaRecord, isPlayableRecord } from "../../../MediaRecord";
import { MediaStreamType } from "../../../MediaProviders/MediaStreams/MediaStream";
import { FileSystemVideoMediaStream } from '../../../Extensions/MediaProviders/FileSystem/MediaStreams/FileSystemVideoStream';
import { Semaphore } from "data-semaphore";
import * as sortBy from 'sort-by';
import { MpvSynchronizerController } from "../../../Subtitles/Validate/MPV/SynchronizerController";
import { InvalidArgumentError, NotFoundError } from "restify-errors";
import { measure } from '../../../Diagnostics';
import { ExternalSynchronize, ExternalSynchronizeCommand } from '../../../Subtitles/Validate/ExternalSynchronize';
import { ManagerSearchOptions } from '../../../Subtitles/ProvidersManager';

export class SubtitlesController extends BaseController {
    protected validateSemaphore : Semaphore = new Semaphore( 1 );

    protected getRequestLanguages ( req : Request ) : string[] {
        let langs = req.query.langs;

        if ( typeof langs === 'string' ) {
            return [ langs ];
        }

        return langs;
    }

    protected getRequestOptions ( req : Request ) : ManagerSearchOptions {
        const options: ManagerSearchOptions = {
            langs: this.getRequestLanguages( req ),
        };

        if ( typeof req.query.episodeOffset === 'number' || typeof req.query.episodeOffset === 'string' ) {
            options.episodeOffset = +req.query.episodeOffset;
        }

        if ( typeof req.query.seasonOffset === 'number' || typeof req.query.seasonOffset === 'string' ) {
            options.seasonOffset = req.query.seasonOffset;
        }

        return options;
    }

    @Route( 'get', '/:kind/:id/local' )
    async listLocal ( req : Request, res : Response ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get( req.params.kind, req.params.id );
        
        return await this.server.subtitles.list( media );
    }

    protected async listRemotePredict ( episode : TvEpisodeMediaRecord, options : ManagerSearchOptions = {} ) {
        const season = await this.server.database.tables.seasons.get( episode.tvSeasonId );
        
        const episodes = await this.server.media.getEpisodes( season.tvShowId );
        
        episodes.sort( sortBy( 'seasonNumber', 'number' ) );
        
        const index = episodes.findIndex( ep => ep.id === episode.id );

        if ( index + 1 < episodes.length ) {
            await this.server.subtitles.providers.search( episodes[ index + 1 ], options );
        }
    }

    @Route( 'get', '/:kind/:id/remote' )
    async listRemote ( req : Request, res : Response ) : Promise<ISubtitle[]> {
        const options = this.getRequestOptions( req );

        const media = await this.server.media.get( req.params.kind as MediaKind, req.params.id );

        if ( !isPlayableRecord( media ) ) {
            throw new InvalidArgumentError( `Invalid media type ${ media.kind }.` );
        }

        const result = await measure( this.server.logger, 'subtitles/search', 
            () => this.server.subtitles.providers.search( media, options )
        );
        
        // When searching for subtitles for an episode, try to predict the next episode we might search
        // (right now just means the next episode number) and start searching so that the results get cached
        // and when the user actually searches for them, the results come faster
        if ( media.kind === MediaKind.TvEpisode ) {
            this.listRemotePredict( media as TvEpisodeMediaRecord, options )
                .catch( err => this.server.onError.notify( err ) );
        }

        return result;
    }

    @Route( 'post', '/:kind/:id/local/:sub/rename' )
    async rename ( req : Request, res : Response ) : Promise<ILocalSubtitle> {
        const media = await this.server.media.get( req.params.kind as MediaKind, req.params.id );

        if ( !isPlayableRecord( media ) ) {
            throw new InvalidArgumentError( `Invalid media type ${ media.kind }.` );
        }

        const subtitles = await this.server.subtitles.get( media, req.params.sub );

        if ( !subtitles ) {
            throw new NotFoundError( 'Requested subtitle was not found.' );
        }

        if ( typeof req.body.releaseName !== 'string' ) {
            throw new InvalidArgumentError( `Expected body releaseName to be string, got "${ typeof req.body.releaseName }"` );
        }

        return await this.server.subtitles.rename( media, subtitles, req.body.releaseName );
    }

    protected async synchronizeSubtitle ( media : PlayableMediaRecord, subtitleFile : string, additionalSubtitles: ILocalSubtitle[], mode: string ) : Promise<boolean> {
        const streams = await this.server.providers.streams( media.sources, { writeCache: false } );

        const video = streams.find( stream => stream.type === MediaStreamType.Video ) as FileSystemVideoMediaStream;
        
        const release = await this.validateSemaphore.acquire();

        try {
            if ( mode === 'binary' ) {
                const player = new MpvSynchronizerController( this.server );
        
                return await player.play( video.file, subtitleFile );
            } else {
                const allConfigs = this.server.config.get<ExternalSynchronizeCommand[]>( 'subtitles.synchronize', [] );
                
                const config = allConfigs.find( config => config.name === mode );

                if ( config != null ) {
                    const resolveSubtitle = async subtitle => {
                        const file = await this.server.storage.getRandomFile( 'synchronize-additional-', 'srt', 'temp/subtitles' );
                        
                        await this.server.subtitles.storeLocalToFile( media, subtitle, file );

                        return file;
                    };

                    const player = new ExternalSynchronize( config, resolveSubtitle );

                    return await player.run( {
                        video: video.file,
                        subtitle: subtitleFile,
                        additionalSubtitles: additionalSubtitles,
                    } );
                } else {
                    const expectedModes = [ 'binary' ].concat( allConfigs.map( config => config.name ) );

                    throw new InvalidArgumentError( `Invalid mode, expected ${ expectedModes.join( ', ' ) }, got "${mode}"` );
                }
            }
        } finally {
            release();
        }
    }
    
    @Route( 'get', '/:kind/:id/local/:sub/synchronize/:mode' )
    async synchronizeLocal ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitle = await this.server.subtitles.get( media, req.params.sub );

        const mode = req.params.mode as string;

        if ( !subtitle ) {
            throw new NotFoundError( 'Requested subtitle was not found.' );
        }

        const file = await this.server.storage.getRandomFile( 'synchronize-local-', 'srt', 'temp/subtitles' );

        const additionalSubtitles = ( await this.server.subtitles.list( media ) )
            .filter( additionalSub => additionalSub.id != subtitle.id );
        
        await this.server.subtitles.storeLocalToFile( media, subtitle, file );

        // Only update the subtitles in the media repository
        // if the synchronization is commited (the user sees it through)
        // When it is canceled in the middle (returning false)
        // ignore the changes
        if ( await this.synchronizeSubtitle( media, file, additionalSubtitles, mode ) ) {
            await this.server.subtitles.delete( media, subtitle );
            
            await this.server.subtitles.updateFromFile( media, subtitle, file );
        }

        return this.server.subtitles.list( media );
    }

    @Route( 'get', '/:kind/:id/remote/:sub/synchronize/:mode' )
    async synchronizeRemote ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitles = await this.server.subtitles.providers.search( media, this.getRequestOptions( req ) );

        const subtitle = subtitles.find( sub => sub.id === req.params.sub );

        const mode = req.params.mode as string;

        if ( !subtitle ) {
            throw new NotFoundError( 'Requested subtitle was not found.' );
        }

        const file = await this.server.storage.getRandomFile( 'synchronize-remote-', 'srt', 'temp/subtitles' );
        
        await this.server.subtitles.storeRemoteToFile( subtitle, file );

        const additionalSubtitles = await this.server.subtitles.list( media );

        // Only update the subtitles in the media repository
        // if the synchronization is commited (the user sees it through)
        // When it is canceled in the middle (returning false)
        // ignore the changes
        if ( await this.synchronizeSubtitle( media, file, additionalSubtitles, mode ) ) {
            await this.server.subtitles.storeFromFile( media, subtitle, file );
        }

        return this.server.subtitles.list( media );
    }

    protected async validateSubtitle ( media : PlayableMediaRecord, subtitleFile : string ) {
        const streams = await this.server.providers.streams( media.sources, { writeCache: false } );

        const video = streams.find( stream => stream.type === MediaStreamType.Video ) as FileSystemVideoMediaStream;
        
        const release = await this.validateSemaphore.acquire();

        try {
            const player = new MpvController( this.server );
    
            await player.play( video.file, subtitleFile );
        } finally {
            release();
        }

        return { success: true };
    }

    @Route( 'get', '/:kind/:id/local/:sub/validate' )
    async validateLocal ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitles = await this.server.subtitles.list( media );

        const subtitle = subtitles.find( sub => sub.id === req.params.sub );

        if ( !subtitle ) {
            throw new NotFoundError( 'Requested subtitle was not found.' );
        }
        
        const file = await this.server.storage.getRandomFile( 'validate-local-', 'srt', 'temp/subtitles' );
        
        await this.server.subtitles.storeLocalToFile( media, subtitle, file );

        await this.validateSubtitle( media, file );
    }

    @Route( 'get', '/:kind/:id/remote/:sub/validate' )
    async validateRemote ( req : Request, res : Response ) {
        const media = await this.server.media.get( req.params.kind, req.params.id ) as PlayableMediaRecord;
        
        const subtitles = await this.server.subtitles.providers.search( media, this.getRequestOptions( req ) );

        const subtitle = subtitles.find( sub => sub.id === req.params.sub );

        if ( !subtitle ) {
            throw new NotFoundError( 'Requested subtitle was not found.' );
        }

        const file = await this.server.storage.getRandomFile( 'validate-remote-', '.srt', 'temp/subtitles' );

        await this.server.subtitles.storeRemoteToFile( subtitle, file )
        
        await this.validateSubtitle( media, file );
    }

    @Route( 'post', '/:kind/:id' )
    async save ( req : Request ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get<PlayableMediaRecord>( req.params.kind, req.params.id );
        
        const body = typeof req.body === 'string' ? JSON.parse( req.body ) : req.body;

        const subtitle : ISubtitle = body.subtitle;

        await this.server.subtitles.store( media, subtitle )

        this.server.providers.forget( media.sources );

        return this.server.subtitles.list( media );
    }

    @Route( 'del', '/:kind/:id/local/:sub' )
    async delete ( req : Request ) : Promise<ILocalSubtitle[]> {
        const media = await this.server.media.get<PlayableMediaRecord>( req.params.kind, req.params.id );
        
        const subtitle = await this.server.subtitles.get( media, req.params.sub );

        await this.server.subtitles.delete( media, subtitle );

        this.server.providers.forget( media.sources );

        return this.server.subtitles.list( media );
    }
}
