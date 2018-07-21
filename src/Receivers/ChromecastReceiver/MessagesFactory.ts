import { MediaPlayOptions } from "../BaseReceiver/IMediaReceiver";
import { MediaStream, MediaStreamType } from "../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, MovieMediaRecord, MediaKind, TvShowMediaRecord, TvSeasonMediaRecord, TvEpisodeMediaRecord, CustomMediaRecord } from "../../MediaRecord";
import * as truncate from 'truncate';
import { SubtitlesMediaStream } from "../../MediaProviders/MediaStreams/SubtitlesStream";
import { VideoMediaStream } from "../../MediaProviders/MediaStreams/VideoStream";
import { ChromecastHttpSender } from "./ChromecastHttpSender";

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

// TODO Move this into the definition of module langs
export interface Language { 
    '1': string, '2': string, '3' : string, '2B' : string, '2T' : string, local : string, name : string
};

export class MessagesFactory {
    readonly sender : ChromecastHttpSender;
    
    constructor ( sender : ChromecastHttpSender ) {
        this.sender = sender;
    }

    getDelayConfig () : { preloadCount: number, duration: number } {
        let config = null;

        if ( this.sender.receiver.config.subtitles ) {
            config = this.sender.receiver.config.subtitles.delay;
        }

        if ( config ) {
            return config;
        }

        return { preloadCount: 0, duration: 0 };
    }

    createSingleTrackMessage ( id : string, index : number, stream : SubtitlesMediaStream, language : Language, offset : number ) : ChromecastPlayTrackMessage {
        return {
            trackId: index,
            type: 'TEXT',
            trackContentId: this.getStreamUrl( id, stream ) + `?offset=${ offset }`, //sender.url( 'stream', extend( { id: subtitles.id }, urlParams ) ) + range,
            trackContentType: 'text/vtt',
            name: language.name,
            language: language[ '2' ],
            subtype: 'SUBTITLES'
        }
    }

    getTracksForSingleSubtitle ( id : string, index : number, stream : SubtitlesMediaStream, options : MediaPlayOptions ) : ChromecastPlayTrackMessage[] {
        const config = this.getDelayConfig();

        const preloadedCount = config.preloadCount || 0;

        const preloadedOffset = config.duration;

        const baseIndex = ( preloadedCount * 2 + 1 ) * index;

        const currentOffset = options.subtitlesOffset || 0;

        const tracks : ChromecastPlayTrackMessage[] = [];
        
        const defaultLanguage : string = this.sender.receiver.server.config.get<string>( 'primaryLanguage', 'en-US' );

        const language = this.getSubtitlesLanguage( 
            // TODO
            ( stream as any ).language || defaultLanguage
        );

        for ( let i = 0; i < preloadedCount; i++ ) {
            let offset = ( options.subtitlesOffset || 0 ) - ( ( preloadedCount - i ) * preloadedOffset );

            tracks.push( this.createSingleTrackMessage( id, baseIndex + i, stream, language, offset ) );
        }

        tracks.push( this.createSingleTrackMessage( id, baseIndex + preloadedCount, stream, language, currentOffset ) );
        
        for ( let i = 0; i < preloadedCount; i++ ) {
            let offset = ( options.subtitlesOffset || 0 ) + ( ( i + 1 ) * preloadedOffset );
            
            tracks.push( this.createSingleTrackMessage( id, baseIndex + preloadedCount + ( i + 1 ), stream, language, offset ) );
        }

        return tracks;
    }

    getTrackIndexForOffset ( index : number, options : MediaPlayOptions, targetOffset : number ) : number {
        const config = this.getDelayConfig();

        const preloadedCount = config.preloadCount || 0;

        const preloadedOffset = config.duration;

        const baseIndex = ( preloadedCount * 2 + 1 ) * index;

        const rest = targetOffset - ( options.subtitlesOffset || 0 );

        if ( rest % preloadedOffset == 0 && Math.abs( rest / preloadedOffset ) <= preloadedCount ) {
            console.log( 'subtitle index for', targetOffset, 'is', baseIndex + preloadedCount + ( rest / preloadedOffset ) );
            return baseIndex + preloadedCount + ( rest / preloadedOffset );
        }

        console.log( 'subtitle index for', targetOffset, 'is', null );
        return null;
    }

    getTrackForSubtitles ( id : string, streams : SubtitlesMediaStream[], options : MediaPlayOptions ) : ChromecastPlayTrackMessage[] {
        return streams.map( ( stream, index ) => this.getTracksForSingleSubtitle( id, index, stream, options ) )
            .reduce( ( array, tracks ) => array.concat( tracks ), [] );
    }

    getStreamUrl ( session : string, stream : MediaStream ) : string {
        return this.sender.host() + this.sender.getUrlFor( session, stream.id );
    }

    getSubtitlesLanguage ( query : string ) : Language {
        const langs = { all : () => [] };

        for ( let lang of langs.all() ) {
            for ( let key of Object.keys( lang ) ) {
                if ( lang[ key ] === query ) {
                    return lang;
                }
            }
        }

        return { 2: 'pt-PT', name: 'Português' } as any;
    }

    async createGeneralMessage ( id : string, streams : MediaStream[], record : MediaRecord, options : MediaPlayOptions ) : Promise<ChromecastPlayMessage> {
        const video : VideoMediaStream = streams.filter( stream => stream.enabled ).find( stream => stream.type === MediaStreamType.Video ) as VideoMediaStream;

        const subtitles : SubtitlesMediaStream[] = streams.filter( stream => stream.enabled ).filter( stream => stream.type === MediaStreamType.Subtitles ) as SubtitlesMediaStream[];

        let tracks : ChromecastPlayTrackMessage[] = this.getTrackForSubtitles( id, subtitles, options );

        return {
            contentId: this.getStreamUrl( id, video ), //sender.url( 'stream', extend( { id: videoStream.id }, urlParams ) ) + range,
            contentType: video.mime,
            tracks: tracks.length > this.getTrackIndexForOffset( 0, options, 0 ) ? tracks : null,
            duration: video.duration,
            streamType: 'BUFFERED',
            metadata: {
                type: 0,
                metadataType: 0,
                session: id,
                title: truncate( record.title, 40 ),
                options: {
                    originalSubtitlesOffset: options.subtitlesOffset || 0,
                },
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