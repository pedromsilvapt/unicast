import { ISubtitlesRepository } from "../../../Subtitles/SubtitlesRepository";
import { MediaRecord, PlayableMediaRecord } from "../../../MediaRecord";
import { ILocalSubtitle } from "../../../Subtitles/SubtitlesManager";
import * as path from 'path';
import { UnicastServer } from "../../../UnicastServer";
import * as isVideo from 'is-video';
import * as isSubtitle from 'is-subtitle';
import * as fs from 'mz/fs';
import { ISubtitle } from "../../../Subtitles/Providers/ISubtitlesProvider";
import * as shorthash from 'shorthash';
import { Pipeline, ParserPipeline, FileReader, DecoderPipeline, StdContext, SubsMessageProtocol, SubLine, MessageProtocol, MessageKind } from 'subbox';
import * as franc from 'franc';
import { toArray } from 'data-async-iterators';

export interface ILocalFileSystemSubtitle extends ILocalSubtitle {
    file : string;
}

export class FileSystemSubtitlesRepository implements ISubtitlesRepository<ILocalFileSystemSubtitle> {
    canWrite : boolean = true;

    server : UnicastServer;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async getFileLanguage ( file : string ) : Promise<string> {
        const pipeline = Pipeline.create( 
            new FileReader(),
            new DecoderPipeline(),
            new ParserPipeline()
        );

        const messages = await toArray( pipeline.run( new StdContext(), file ) );

        const lines = messages.filter( s => s.kind == MessageKind.Data ).map( s => ( s.payload as SubLine ).text );

        const text = lines.join( '\n' );

        return franc( text );
    }

    getMediaFile ( media : MediaRecord ) : string {
        const playable : PlayableMediaRecord = media as any;

        const isPath = ( source : string ) => this.server.providers.get( 'filesystem' ).match( source );

        const files : string[] = playable.sources
            .filter( source => isPath( source.id ) )
            .filter( source => isVideo( source.id ) )
            .map( source => source.id );

        if ( !files.length ) {
            throw new Error( `Could not find subtitles for ${ media.id }.` );
        }

        return files[ 0 ];
    }

    async has ( media : MediaRecord, id : string ) : Promise<boolean> {
        return ( await this.get( media, id ) ) != null;
    }

    async get ( media : MediaRecord, id : string ) : Promise<ILocalFileSystemSubtitle> {
        const list = await this.list( media );

        return list.find( sub => sub.id === id );
    }

    async list ( media : MediaRecord ) : Promise<ILocalFileSystemSubtitle[]> {
        const file = this.getMediaFile( media );

        const folder = path.dirname( file );

        const filePrefix = path.basename( file, path.extname( file ) );

        const otherFiles = await fs.readdir( folder );
        
        const matchingFiles = otherFiles
            .filter( file => file.startsWith( filePrefix ) )
            .filter( file => isSubtitle( file ) );
        
        const subtitles : ILocalFileSystemSubtitle[] = [];
        
        for ( let subFile of matchingFiles ) {
            const subFilePath = path.join( folder, subFile );

            subtitles.push( {
                id: shorthash.unique( subFilePath ),
                format: path.extname( subFile ),
                language: await this.getFileLanguage( subFilePath ),
                releaseName: path.basename( subFile, path.extname( subFile ) ),
                file: subFile
            } );
        }
        
        return subtitles;
    }

    read ( media : MediaRecord, subtitle : ILocalFileSystemSubtitle ) : Promise<NodeJS.ReadableStream> {
        const folder = path.dirname( this.getMediaFile( media ) );
        
        const file = path.join( folder, subtitle.releaseName + subtitle.format );

        return Promise.resolve( fs.createReadStream( file ) );
    }

    async store ( media : MediaRecord, subtitle : ISubtitle, data : NodeJS.ReadableStream | Buffer) : Promise<ILocalFileSystemSubtitle> {
        const extension = '.' + ( subtitle.format || 'srt' ).toLowerCase();

        const video = this.getMediaFile( media );

        const prefix = path.join( path.dirname( video ), path.basename( video, path.extname( video ) ) );

        let file = prefix + extension;

        let index = 1;

        while ( await fs.exists( file ) ) file = prefix + '-' + index++ + extension;

        if ( Buffer.isBuffer( data ) ) {
            await fs.writeFile( file, data );
        } else {
            await new Promise<void>( ( resolve, reject ) =>
                data.pipe( fs.createWriteStream( file ) ).on( 'error', reject ).on( 'finish', resolve )
            ); 
        }

        return {
            id: shorthash.unique( file ),
            format: path.extname( file ),
            language: null,
            releaseName: path.basename( file, path.extname( file ) ),
            file: path.basename( file )
        };
    }

    async update ( media : MediaRecord, subtitle : ILocalFileSystemSubtitle, data : NodeJS.ReadableStream | Buffer) : Promise<ILocalFileSystemSubtitle> {
        const file = subtitle.file;

        if ( Buffer.isBuffer( data ) ) {
            await fs.writeFile( file, data );
        } else {
            await new Promise<void>( ( resolve, reject ) =>
                data.pipe( fs.createWriteStream( file ) ).on( 'error', reject ).on( 'finish', resolve )
            );
        }

        return subtitle;
    }

    async delete ( media : MediaRecord, subtitle : ILocalFileSystemSubtitle ) : Promise<void> {
        const folder = path.dirname( this.getMediaFile( media ) );

        const file = path.join( folder, subtitle.file );
        
        if ( await fs.exists( file ) ) {
            await fs.unlink( file );
        }
    }
    
}