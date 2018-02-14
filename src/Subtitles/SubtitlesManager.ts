import { SubtitlesProvidersManager } from "./ProvidersManager";
import { UnicastServer } from "../UnicastServer";
import { OpenSubtitlesSubtitles } from "./Providers/OpenSubtitles/OpenSubtitlesProvider";
import { ISubtitle } from "./Providers/ISubtitlesProvider";
import { MediaRecord } from "../MediaRecord";
import { FallbackSubtitlesRepository, IDatabaseLocalSubtitle } from "./SubtitlesRepository";
import * as fs from 'mz/fs';
import { saveStreamTo } from "../ArtworkCache";

export interface ILocalSubtitle {
    id ?: string;
    releaseName : string;
    language : string;
    format : string;
}

export class SubtitlesManager {
    server : UnicastServer;

    providers : SubtitlesProvidersManager;

    repository : FallbackSubtitlesRepository;

    constructor ( server : UnicastServer ) {
        this.server = server;

        this.providers = new SubtitlesProvidersManager( server );

        this.providers.add( new OpenSubtitlesSubtitles );

        this.repository = new FallbackSubtitlesRepository( server );
    }

    async get ( media : MediaRecord, id : string ) : Promise<ILocalSubtitle> {
        const mediaRepository = this.server.repositories.get( media.repository, media.kind );

        if ( !mediaRepository || !mediaRepository.subtitles ) {
            return this.repository.get( media, id );
        } else if ( mediaRepository.subtitles.canWrite ) {
            return mediaRepository.subtitles.get( media, id );
        } else {
            const [ native, embedded ] = await Promise.all( [
                mediaRepository.subtitles.get( media, id ),
                this.repository.get( media, id )
            ] );

            return native || embedded;
        }
    }

    async list ( media : MediaRecord ) : Promise<ILocalSubtitle[]> {
        const mediaRepository = this.server.repositories.get( media.repository, media.kind );

        if ( !mediaRepository || !mediaRepository.subtitles ) {
            return this.repository.list( media );
        } else if ( mediaRepository.subtitles.canWrite ) {
            return mediaRepository.subtitles.list( media );
        } else {
            const [ native, embedded ] = await Promise.all( [
                mediaRepository.subtitles.list( media ),
                this.repository.list( media )
            ] );

            return [ ...native, ...embedded ];
        }
    }

    async storeLocalToFile ( media : MediaRecord, subtitle : ILocalSubtitle, file : string ) {
        const reader = await this.read( media, subtitle );

        await saveStreamTo( reader, file );
    }

    async storeRemoteToFile ( subtitle : ISubtitle, file : string ) {
        const reader = await this.providers.download( subtitle );

        await saveStreamTo( reader, file );
    }

    async store ( media : MediaRecord, subtitle : ISubtitle ) : Promise<ILocalSubtitle> {
        const body = await this.providers.download( subtitle );
        
        const mediaRepository = this.server.repositories.get( media.repository, media.kind );

        if ( !mediaRepository || !mediaRepository.subtitles ) {
            return this.repository.store( media, subtitle, body );
        } else if ( mediaRepository.subtitles.canWrite ) {
            return mediaRepository.subtitles.store( media, subtitle, body );
        } else {
            return this.repository.store( media, subtitle, body );
        }
    }

    async delete ( media : MediaRecord, subtitle : ILocalSubtitle ) : Promise<void> {
        const mediaRepository = this.server.repositories.get( media.repository, media.kind );

        if ( !mediaRepository || !mediaRepository.subtitles ) {
            return this.repository.delete( media, subtitle as IDatabaseLocalSubtitle );
        } else if ( mediaRepository.subtitles.canWrite ) {
            return mediaRepository.subtitles.delete( media, subtitle );
        } else {
            return this.repository.delete( media, subtitle as IDatabaseLocalSubtitle );
        }
    }

    async read ( media : MediaRecord, subtitle : ILocalSubtitle ) : Promise<NodeJS.ReadableStream> {
        const mediaRepository = this.server.repositories.get( media.repository, media.kind );

        if ( !mediaRepository || !mediaRepository.subtitles ) {
            return this.repository.read( media, subtitle as IDatabaseLocalSubtitle );
        } else {
            if ( await this.repository.has( media, subtitle.id ) ) {
                return this.repository.read( media, subtitle as IDatabaseLocalSubtitle );
            } else {
                return mediaRepository.subtitles.read( media, subtitle );
            }
        }
    }
}