import { IVideoPlayerController } from "../IVideoPlayerController";
import { UnicastServer } from "../../../UnicastServer";
import { Pipeline, FileReader, FileWriter, ParserPipeline, DecoderPipeline, SubLine, SubboxPipeline, MessageProtocol, MessageKind, ContextManager, StdContext, CompilerPipeline, EncoderPipeline, MessageFactory } from 'subbox';
import { filter, map, toArray, fromArray } from "data-async-iterators";
import * as path from 'path';
import * as fs from 'mz/fs';
import * as sortBy from 'sort-by';
import { MpvPlayer } from './Player';

const ControllerSource = fs.readFileSync( path.join( __dirname, 'SynchronizerController.txt.js' ), 'utf8' );

export class ArrayReader<T> extends SubboxPipeline<T[] | Promise<T[]>, AsyncIterableIterator<MessageProtocol<T>>> {
    protected format : string;

    protected encoding : string;

    constructor ( format : string = null, encoding : string = null ) {
        super();

        this.format = format;
        this.encoding = encoding;
    }

    async * run ( env : ContextManager, input ?: T[] | Promise<T[]> ) : AsyncIterableIterator<MessageProtocol<T>> {
        yield MessageFactory.start( this.format ? env.formats.get( this.format ) : null, this.encoding );

        yield * fromArray( ( await Promise.resolve( input ) ).map( line => MessageFactory.data( line ) ) );

        yield MessageFactory.end();
    }
}

export class ArrayWriter<T> extends SubboxPipeline<AsyncIterableIterator<MessageProtocol<T>>, Promise<T[]>> {
    run ( env : ContextManager, input ?: AsyncIterableIterator<MessageProtocol<T>> ) : Promise<T[]> {
        const data = map( filter( input, message => message.kind == MessageKind.Data ), message => message.payload as T );

        return toArray( data );
    }
}

export class MpvSynchronizerController implements IVideoPlayerController<boolean> {
    server : UnicastServer;

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async getSubtitles ( subtitles : string ) : Promise<SubLine[]> {
        const pipeline = Pipeline.create(
            new FileReader(),
            new DecoderPipeline(),
            new ParserPipeline(),
            new ArrayWriter()
        );

        return await pipeline.run( new StdContext(), subtitles ) as SubLine[];
    }

    fixSubtitles ( subtitles : SubLine[], fixes : { [ key : string ] : number } ) : SubLine[] {
        fixes = { '300': 1000, '200': 500 };

        // Sorted Accomulated Delays
        // '0' means "sort by the first index of the array"
        const sad = Object.keys( fixes ).map( key => [ +key, fixes[ key ] ] as [ number, number ] ).sort( sortBy( '0' ) );

        // let acc = 0;

        // for ( let delay of sad ) {
        //     delay[ 1 ] -= acc;
            
        //     acc += delay[ 1 ];
        // }

        let i = -1;

        return subtitles.map( ( line, index ) => {
            while ( sad.length > i + 1 && sad[ i + 1 ][ 0 ] <= index ) i++;

            if ( i < 0 ) {
                return line;
            }

            const offset = sad[ i ][ 1 ];

            return new SubLine( line.start + offset, line.end + offset, line.text );
        } );
    }

    async setSubtitles ( subtitles : SubLine[], file : string ) : Promise<void> {
        const pipeline = Pipeline.create(
            new ArrayReader( 'srt', 'utf8' ),
            new CompilerPipeline(),
            new EncoderPipeline( 'utf8' ),
            new FileWriter( file )
        );

        await pipeline.run( new StdContext(), subtitles );
    }

    protected async run ( video : string, subtitles : string, controller : string ) {
        const player = MpvPlayer.fromServer( this.server, video, subtitles );

        player.script = controller;

        await player.run().wait();
    }

    async backup ( file : string ) {
        const backupName = path.join( path.dirname( file ), path.basename( file, path.extname( file ) ) + '-backup' + path.extname( file ) );

        await fs.writeFile( backupName, await fs.readFile( file ) );

        return backupName;
    }

    async play ( video : string, subtitles : string ) : Promise<boolean> {
        const lines = await this.getSubtitles( subtitles );

        this.fixSubtitles( lines, {} );

        const sourceFile = await this.server.storage.getRandomFile( 'mpv-synchronizer-controller-', 'js', 'temp/subtitles' );

        const outputFile = await this.server.storage.getRandomFile( 'mpv-synchronizer-output-', 'json', 'temp/subtitles' );

        const source = ( ControllerSource as string )
            .replace( /__lines__/, JSON.stringify( lines ) )
            .replace( /__output__/, JSON.stringify( outputFile ) );

        await fs.writeFile( sourceFile, source, 'utf8' );

        await this.run( video, subtitles, sourceFile );

        if ( await fs.exists( outputFile ) ) {
            const fixes = JSON.parse( await fs.readFile( outputFile, 'utf8' ) );

            const fixed = this.fixSubtitles( lines, fixes );

            await this.backup( subtitles );

            await this.setSubtitles( fixed, subtitles );

            return true;
        } else {
            console.log( 'no ' + outputFile + ' file found.' );

            return false;
        }
    }
}