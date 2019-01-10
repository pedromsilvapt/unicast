import { UnicastServer } from './UnicastServer';
import { VideoMediaStream } from './MediaProviders/MediaStreams/VideoStream';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import { MediaTools } from './MediaTools';
import * as fs from 'mz/fs';
import { MediaRecord } from './MediaRecord';

export class MediaPreview {
    protected server : UnicastServer;
    protected media : MediaRecord;
    protected stream : VideoMediaStream;
    protected time : number;
    width : number = 350;
    height : number = -1;

    constructor ( server : UnicastServer, media : MediaRecord, stream : VideoMediaStream, time : number ) {
        this.server = server;
        this.media = media;
        this.stream = stream;
        this.time = time;
    }

    getFileExtension () : string {
        return 'png';
    }

    generate () : Readable {
        const url = this.server.getUrl( this.server.streams.getUrlFor( this.media.kind, this.media.id, this.stream.id ) );

        const args = [ 
            '-ss', this.time.toString(), 
            '-i', url, '-y',
            '-frames:v', '1',
            '-c:v', 'png',
            '-vf', `scale=${ this.width }:${ this.height }`,
            '-f', 'image2pipe',
            '-'
        ];

        const command = spawn( MediaTools.getCommandPath( this.server ), args );

        command.on( "error", error => command.stdout.emit( "error", error ) );

        return command.stdout;
    }

    save ( file : string ) : Promise<void> {
        try {
            return new Promise<void>( ( resolve, reject ) => {
                this.generate().pipe( fs.createWriteStream( file ) )
                    .on( 'error', reject )
                    .on( 'finish', () => resolve() );
            } );
        } catch ( error ) {
            return Promise.reject( error );
        }
    }

    async saveToTemp () : Promise<string> {
        const file = await this.server.storage.getRandomFile( 'preview-', this.getFileExtension() );

        await this.save( file );

        return file;
    }
}