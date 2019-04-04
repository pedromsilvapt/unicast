import { Tool, ToolOption, ToolValueType } from "./Tool";
import { MediaKind, AllMediaKinds, PlayableQualityRecord } from "../MediaRecord";
import * as parseTorrentName from 'parse-torrent-name';
import { MediaTools } from "../MediaTools";
import * as path from 'path';
import * as r from 'rethinkdb';

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
}

export class AddCustomTool extends Tool<AddCustomOptions> {
    getParameters () {
        return [
            new ToolOption( 'video' ).setRequired(),
            new ToolOption( 'mediaKind' ).setAllowedValues( AllMediaKinds ).setRequired(),
            new ToolOption( 'mediaId' ).setRequired()
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'target' ).setType( ToolValueType.String ).setAllowedValues( [ 'history', 'playlist', 'play', 'none' ] ).setDefaultValue( 'history' ),
            new ToolOption( 'title' ),
            new ToolOption( 'device' ),
            new ToolOption( 'playlist' ),
        ];
    }
    
    async getNewestPlaylist ( device : string ) : Promise<string> {
        const playlist = await this.server.database.tables.playlists.findOne( query => {
            return query.orderBy( { index: r.desc( 'createdAt' ) } ).filter( { device: device } ).limit( 1 );
        } );

        if ( !playlist ) {
            return null;
        }

        return playlist.id;
    }

    async getVideoMetadata ( location : string ) : Promise<[number, PlayableQualityRecord]> {
        let runtime = null;

        let quality : PlayableQualityRecord = {
            codec: null,
            releaseGroup: null,
            resolution: null,
            source: null
        };

        const metadata = await MediaTools.probe( location ).catch( err => null );

        if ( metadata ) {
            const video = metadata.tracks.find( stream => stream.type == 'video' );
                
            if ( video ) {
                runtime = video.duration;
        
                quality.codec = video.codec;
                quality.resolution = '' + video.height + 'p';
            }
        } else {
            const parsed = parseTorrentName( path.basename( location, path.extname( location ) ) ) || {};
    
            quality.codec = parsed.codec || null;
            quality.releaseGroup = parsed.group || null;
            quality.resolution = parsed.resolution || null;
            quality.source = parsed.quality || null;
        }
        
        return [ runtime, quality ];
    }

    async run ( options : AddCustomOptions ) {
        const parent = await this.server.media.get( options.mediaKind, options.mediaId );

        if ( !parent ) {
            this.logger.error( `Parent media item not found: [${ options.mediaKind }, ${ options.mediaId }]` );
        }

        const [ runtime, quality ] = await this.getVideoMetadata( options.video );

        let record = await this.server.database.tables.custom.create( {
            "art": parent.art,
            "external": { },
            "internalId": null,
            "kind": MediaKind.Custom,
            "lastPlayed": null,
            "playCount": 0,
            "quality": quality,
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

            playlist.references.push( { kind: MediaKind.Custom, id: record.id } );

            await this.server.database.tables.playlists.update( playlist.id, playlist );

            this.log( 'Added media record to playlist', playlistId );
        }
    }
}