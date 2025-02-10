import { Tool, ToolOption, ToolValueType } from "./Tool";
import { MediaKind, AllMediaKinds, MediaRecordArt } from "../MediaRecord";
import * as path from 'path';
import { MediaMetadata } from '../Database/Tables/AbstractMediaTable';

export enum AddCustomTarget {
    History = 'history',
    Playlist = 'playlist',
    Play = 'play',
    None = 'none'
}

export interface AddCustomOptions {
    video : string;
    mediaKind : MediaKind;
    mediaId : string;
    target : AddCustomTarget;
    dryRun : boolean;
    title ?: string;
    device ?: string;
    playlist ?: string;

    background ?: string;
    thumbnail ?: string;
    banner ?: string;
    poster ?: string;
}

export class AddCustomTool extends Tool<AddCustomOptions> {
    getParameters () {
        return [
            new ToolOption( 'video' ).setRequired(),
            new ToolOption( 'mediaKind' ).setAllowedValues( AllMediaKinds ).setRequired( false ),
            new ToolOption( 'mediaId' ).setRequired( false )
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'target' ).setType( ToolValueType.String ).setAllowedValues( [ 'history', 'playlist', 'play', 'none' ] ).setDefaultValue( 'history' ),
            new ToolOption( 'title' ),
            new ToolOption( 'device' ),
            new ToolOption( 'playlist' ),

            new ToolOption( 'background' ),
            new ToolOption( 'thumbnail' ),
            new ToolOption( 'poster' ),
            new ToolOption( 'banner' ),
        ];
    }

    async getNewestPlaylist ( device : string ) : Promise<string> {
        const playlist = await this.server.database.tables.playlists.findOne( query => {
            return query.orderBy( 'createdAt', 'desc' ).where( { device: device } ).limit( 1 );
        } );

        if ( !playlist ) {
            return null;
        }

        return playlist.id;
    }

    async getVideoMetadata ( location : string ) : Promise<[number, MediaMetadata | null]> {
        let runtime = null;

        let metadata : MediaMetadata | null = null;

        const probe = await this.server.mediaTools.probe( location ).catch( err => null );

        if ( probe != null ) {
            metadata = await this.server.mediaTools.convertToMetadata( probe );

            runtime = metadata.duration;
        }

        return [ runtime, metadata ];
    }

    async run ( options : AddCustomOptions ) {
        let art : MediaRecordArt = {
            background: null,
            banner: null,
            poster: null,
            thumbnail: null
        };

        if ( options.mediaKind != null && options.mediaId != null ) {
            const parent = await this.server.media.get( options.mediaKind, options.mediaId );

            if ( !parent ) {
                this.logger.error( `Parent media item not found: [${ options.mediaKind }, ${ options.mediaId }]` );
            } else {
                Object.assign( art, parent.art );
            }
        }

        if ( options.background != null ) art.background = options.background;
        if ( options.thumbnail != null ) art.thumbnail = options.thumbnail;
        if ( options.poster != null ) art.poster = options.poster;
        if ( options.banner != null ) art.banner = options.banner;

        const [ runtime, metadata ] = await this.getVideoMetadata( options.video );

        let record = await this.server.database.tables.custom.create( {
            "art": art,
            "external": { },
            "internalId": null,
            "kind": MediaKind.Custom,
            "scraper": null,
            "lastPlayedAt": null,
            "playCount": 0,
            "metadata": metadata,
            "repository": null,
            "runtime": runtime,
            "sources": [ { "id": options.video } ],
            "title": options.title || path.basename( options.video, path.extname( options.video ) ),
            "transient": true,
            "watched": false,
            "addedAt": new Date(),
            "createdAt": new Date(),
            "updatedAt": new Date()
        } );

        this.log( 'Created media record', 'custom', record.id );

        const deviceName = options.device || Array.from( this.server.receivers.keys() )[ 0 ];

        if ( !deviceName ) {
            throw new Error( `No device name provided.` );
        }

        const device = this.server.receivers.get( deviceName );

        if ( !device ) {
            throw new Error( `No device named ${ deviceName } was found.` );
        }

        if ( options.target == AddCustomTarget.History || options.target == AddCustomTarget.Play ) {
            const opts : any = {};

            const session = await device.sessions.register( record, opts );

            this.log( 'Created session', session );

            if ( options.target == AddCustomTarget.Play ) {
                this.log( 'Playing session...' );

                await device.play( session );

                this.log( 'Playback started.' );
            }
        } else if ( options.target == AddCustomTarget.Playlist ) {
            const playlistId = options.playlist || await this.getNewestPlaylist( device.name );

            if ( !playlistId ) {
                throw new Error( `No playlist id provided.` );
            }

            const playlist = await this.server.database.tables.playlists.get( playlistId );

            if ( !playlist ) {
                throw new Error( `No playlist with id ${ playlistId } was found.` );
            }

            const items = await this.server.database.tables.playlistsMedia.find( q => q.where( 'playlistId', playlist.id ) );

            let order = 0;

            if ( items.length > 0 ) {
                order = Math.max( ...items.map( i => i.order ) ) + 1;
            }

            await this.server.database.tables.playlistsMedia.create( {
                playlistId: playlist.id,
                mediaKind: MediaKind.Custom,
                mediaId: record.id,
                order: order,
            } );

            this.log( 'Added media record to playlist', playlistId );
        }
    }
}
