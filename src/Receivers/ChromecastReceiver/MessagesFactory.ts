import { MediaPlayOptions } from "../BaseReceiver/IMediaReceiver";
import { MediaStream, MediaStreamType } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, MovieMediaRecord, MediaKind, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, CustomMediaRecord } from "../../MediaRecord";
import * as truncate from 'truncate';
import { SubtitlesMediaStream } from "../../MediaProviders/MediaStreams/SubtitlesStream";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { HttpSender } from "../BaseReceiver/HttpSender";

export interface ChromecastPlayTrackMessage {
    trackId: number,
    type: string,
    trackContentId: string,
    trackContentType: string,
    name: string,
    language: string,
    subtype: string
};

export interface ChromecastPlayMessage {
    contentId: string;
    contentType: string;
    tracks: ChromecastPlayTrackMessage[],
    metadata: {
        type: number,
        metadataType: number,
        title: string;
        images: { url : string }[];

        // Movie
        releaseDate?: string;

        // Tv Show Episode
        seriesTitle?: string;
        episode?: number;
        season?: number;

        [ key : string ] : any;
    };
    streamType ?: string;
    duration ?: number;
    textTrackStyle ?: any;
}

export class MessagesFactory {
    readonly sender : HttpSender;
    
    constructor ( sender : HttpSender ) {
        this.sender = sender;
    }

    async getStreamUrl ( session : string, stream : MediaStream ) : Promise<string> {
        return await this.sender.host() + this.sender.getUrlFor( session, stream.id );
    }

    async createGeneralMessage ( id : string, streams : MediaStream[], record : MediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        const video : VideoMediaStream = streams.filter( stream => stream.enabled ).find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;

        const subtitles : SubtitlesMediaStream[] = streams.filter( stream => stream.enabled ).filter( stream => stream.type === MediaStreamType.Subtitles ) as SubtitlesMediaStream[];

        let tracks : ChromecastPlayTrackMessage[] = [];

        for ( let [ index, subtitle ] of subtitles.entries() ) {
            tracks.push( {
                trackId: index,
                type: 'TEXT',
                trackContentId: await this.getStreamUrl( id, subtitle ), //sender.url( 'stream', extend( { id: subtitles.id }, urlParams ) ) + range,
                trackContentType: 'text/vtt',
                name: subtitles.name || 'Português',
                language: subtitles.language || 'pt-PT',
                subtype: 'SUBTITLES'
            } );
        }

        return {
            contentId: await this.getStreamUrl( id, video ), //sender.url( 'stream', extend( { id: videoStream.id }, urlParams ) ) + range,
            contentType: video.mime,
            tracks: tracks.length > 0 ? tracks : null,
            duration: video.duration,
            streamType: 'BUFFERED',
            metadata: {
                type: 0,
                metadataType: 0,
                session: id,
                title: truncate( record.title, 40 ),
                images: [
                    { url: record.art.thumbnail || record.art.poster }
                ]
            }
        };
    }

    async createMovieMessage ( id : string, streams : MediaStream[], record : MovieMediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        const general = await this.createGeneralMessage( id, streams, record, options );

        return {
            ...general,
            metadata: {
                ...general.metadata,
                metadataType: 1,
                releaseDate: `${record.year}-01-01`
            }
        };
    }

    async createTvEpisodeMessage ( id : string, streams : MediaStream[], record : TvEpisodeMediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        const general = await this.createGeneralMessage( id, streams, record, options );

        const season = await this.sender.receiver.server.media.get( MediaKind.TvSeason, record.tvSeasonId );

        const show = await this.sender.receiver.server.media.get( MediaKind.TvShow, season.tvShowId );

        return {
            ...general,
            metadata: {
                ...general.metadata,
                metadataType: 2,
				seriesTitle: show.title,
				episode: record.number,
				season: record.seasonNumber
            }
        };
    }

    async createCustomMessage ( id : string, streams : MediaStream[], record : CustomMediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        const general = await this.createGeneralMessage( id, streams, record, options );
        
        return {
            ...general,
            metadata: {
                ...general.metadata,
                metadataType: 0,
            }
        };
    }

    async createMediaMessage ( id : string, streams : MediaStream[], record : MediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        switch ( record.kind ) {
            case MediaKind.Movie:
                return this.createMovieMessage( id, streams, record as MovieMediaRecord, options );
            case MediaKind.TvEpisode:
                return this.createTvEpisodeMessage( id, streams, record as TvEpisodeMediaRecord, options );
            case MediaKind.Custom:
                return this.createCustomMessage( id, streams, record as CustomMediaRecord, options );
        }
    }
}