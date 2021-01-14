import { MediaSource } from "../../../MediaProviders/MediaSource";
import { MediaStream } from "../../../MediaProviders/MediaStreams/MediaStream";
import { MediaRecord, CustomMediaRecord, MediaKind, PlayableQualityRecord, MediaRecordArt } from "../../../MediaRecord";
import * as ytdl from 'ytdl-core';
import { YoutubeVideoMediaStream } from "./MediaStreams/YoutubeVideoStream";
import { SubtitlesDownloader } from "./SubtitlesDownloader";
import { YoutubeSubtitlesMediaStream } from "./MediaStreams/YoutubeSubtitlesStream";

export class YoutubeMediaSource extends MediaSource {
    format : ytdl.videoFormat;

    videoInfo : ytdl.videoInfo;

    targets : Partial<ytdl.videoFormat>[] = [ { resolution: '720p', container: 'mp4' }, { resolution: '480p', container: 'mp4' }, { resolution: '360p', container: 'mp4' } ]

    match<T extends object> ( object : T, target : Partial<T> ) {
        for ( let key of Object.keys( target ) ) {
            if ( object[ key ] != target[ key ] ) {
                return false;
            }
        }

        return true;
    }

    selectFormat ( formats : ytdl.videoFormat[] ) : ytdl.videoFormat {
        for ( let target of this.targets ) {
            const match = formats.find( format => this.match( format, target ) );
            
            if ( match ) {
                return match;
            }
        }
    }

    async scan () : Promise<MediaStream[]> {
        const file : string = this.details.id;

        this.videoInfo = await ytdl.getInfo( file );
        
        this.format = this.selectFormat( this.videoInfo.formats );
        
        const streams : MediaStream[] = [];

        streams.push( new YoutubeVideoMediaStream( file, this ) );

        const subtitlesDownloader = new SubtitlesDownloader();

        const subtitles = await subtitlesDownloader.find( file );

        if ( subtitles ) {
            streams.push( new YoutubeSubtitlesMediaStream( subtitles.url, this, subtitles ) );
        }

        return streams;
    }

    getVideoThumbnail ( thumbnails : any[] ) : any {
        let maxHeight = null;

        for ( let thumb of thumbnails ) {
            if ( !maxHeight || thumb.height > maxHeight.height ) {
                maxHeight = thumb;
            }
        }

        if ( maxHeight ) {
            return maxHeight.url;
        }

        return maxHeight;
    }

    getArt ( property : string ) : Promise<NodeJS.ReadableStream> {
        return null;
    }

    async getArtUrl ( property : string ) {
        return null;
    }

    async info () : Promise<MediaRecord> {
        if ( this.details.record ) {
            return this.details.record;
        }

        let runtime : number = Math.round( +this.videoInfo.player_response.videoDetails.lengthSeconds / 60 );

        let quality : PlayableQualityRecord = {
            codec: this.format.encoding,
            releaseGroup: null,
            resolution: this.format.resolution,
            source: null
        };

        let art : MediaRecordArt = {
            thumbnail: this.getVideoThumbnail( this.videoInfo.player_response.videoDetails.thumbnail.thumbnails ),
            background: null,
            banner: null,
            poster: null
        };

        return {
            art: art,
            addedAt: new Date(),
            external: {},
            internalId: this.videoInfo.player_response.videoDetails.videoId,
            kind: MediaKind.Custom,
            lastPlayedAt: null,
            playCount: 0,
            quality: quality,
            repository: null,
            runtime: runtime,
            title: this.videoInfo.player_response.videoDetails.title,
            watched: false,
            plot: this.videoInfo.description,
            // TODO since this.videoInfo.author.name for now appears to just return undefined
            // replace it with this.videoInfo.media.category
            subtitle: this.videoInfo.player_response.videoDetails.author + ' (in ' + this.videoInfo.media.category + ')',
        } as CustomMediaRecord;
    }
}