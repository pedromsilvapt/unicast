import { Tool, ToolOption, ToolValueType } from "./Tool";
import { Duration } from '../ES2017/Units';
import { isPlayableRecord } from '../MediaRecord';
import { SubboxPipeline, StdContext, FileReader, ParserPipeline, CompilerPipeline, FileWriter, OffsetPipeline, MessageProtocol, SubLine, MessageKind, MessageFactory, DecoderPipeline, EncoderPipeline } from 'subbox';
import * as path from 'path';
import { map } from 'data-async-iterators';

interface PersistSubtitlesOptions {
    key : string;
    value : string;
    apply : boolean;
}

export class PersistSubtitlesTool extends Tool<PersistSubtitlesOptions> {
    getParameters () {
        return [ 
            new ToolOption( 'key' ).setRequired( false ),
            new ToolOption( 'value' ).setRequired( false )
        ]
    }

    getOptions () {
        return [
            new ToolOption( 'apply' ).setType( ToolValueType.Boolean ).setDefaultValue( false )
        ];
    }

    async run ( options : PersistSubtitlesOptions ) {
        const sameAdjustmentWindow = 60;

        console.log( options.key, options.value );

        const changes = [];

        // Young Sheldon S01E01 - media.id 63626263-d84e-4fdd-b41f-84b4faeda86c
        // Young Sheldon S01E02 - media.id 10bf09d0-d1c3-415f-a0cc-9f14e65e87a6
        // Young Sheldon S01E03 - media.id 74edeb2f-9cd2-4a35-a423-c5f964416000
        // Young Sheldon S01E04 - media.id e0039934-2697-41f2-b013-922b7d8de88b

        let mediaIds = null;

        for await ( let command of this.server.rcHistory.readKeyed( options.key, options.value ) ) {
            mediaIds = mediaIds || command.media;

            if ( changes.length == 0 || command.playtime - changes[ changes.length - 1 ].end > sameAdjustmentWindow ) {
                changes.push( { start: command.playtime, end: command.playtime, offset: command.args[ 0 ] } );
            } else {
                const last = changes[ changes.length - 1 ];

                last.end = command.playtime;
                last.offset = command.args[ 0 ];
            }
        }

        for ( let command of changes ) {
            console.log( Duration.parse( command.start ).toHumanShortString(), ' = ', command.offset );
        }

        if ( options.apply ) {
            await this.server.database.install();

            const record = await this.server.media.get( mediaIds.kind, mediaIds.id );

            if ( isPlayableRecord( record ) ) {
                const movie = record.sources[ 0 ].id;

                const basepath = path.join( path.dirname( movie ), path.basename( movie, path.extname( movie ) ) );

                const input = basepath + '.srt';
                const output = basepath + '.corrected.srt';

                const offsets = changes.map( c => ( { start: c.start * 1000, offset: c.offset } ) );

                const pipeline = SubboxPipeline.create( 
                    new FileReader( 'utf8' ),
                    new DecoderPipeline(),
                    new ParserPipeline(),
                    new VariableOffsetPipeline( offsets ),
                    new CompilerPipeline(),
                    new EncoderPipeline( 'utf8' ),
                    new FileWriter( output )
                );

                console.log( input );
                console.log( output );
                
                await pipeline.run( new StdContext(), input );
            }
        }
    }
}

export class VariableOffsetPipeline extends SubboxPipeline<AsyncIterable<MessageProtocol<SubLine>>, AsyncIterable<MessageProtocol<SubLine>>> {
    offsets : { start: number, offset: number }[];
    
    constructor ( offsets : { start: number, offset: number }[] ) {
        super();

        this.offsets = offsets;
    }

    run ( ctx : StdContext, input : AsyncIterable<MessageProtocol<SubLine>> ) : AsyncIterable<MessageProtocol<SubLine>> {
        let cursor = 0;

        if ( this.offsets.length == 0 ) {
            return input;
        }

        return map( input, message => {
            if ( message.kind != MessageKind.Data ) {
                return message;
            }

            if ( message.payload.start < this.offsets[ cursor ].start ) {
                return message;
            }

            const line = message.payload.clone();

            while ( ( cursor + 1 ) < this.offsets.length && this.offsets[ cursor + 1 ].start <= ( line.start + this.offsets[ cursor ].offset ) ) {
                cursor++;
            }

            line.start += this.offsets[ cursor ].offset;
            line.end += this.offsets[ cursor ].offset;

            return MessageFactory.data( line );
        } );
    }
}