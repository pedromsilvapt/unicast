import { Tool, ToolOption, ToolValueType } from "./Tool";
import { Duration } from '../ES2017/Units';
import { isPlayableRecord } from '../MediaRecord';
import { SubboxPipeline, StdContext, FileReader, ParserPipeline, CompilerPipeline, FileWriter, OffsetPipeline, MessageProtocol, SubLine, MessageKind, MessageFactory, DecoderPipeline, EncoderPipeline } from 'subbox';
import * as path from 'path';
import { map } from 'data-async-iterators';
import { MediaTools } from '../MediaTools';
import { BlackSceneDetector, Scene } from 'composable/executors';
import { source } from 'composable';
import { MpvController } from '../Subtitles/Validate/MPV/Controller';
import { UnicastServer } from '../UnicastServer';
import * as sortBy from 'sort-by';

interface PersistSubtitlesOptions {
    key : string;
    value : string;
    apply : boolean;
    verify : boolean;
    shiftToBlackScenes : boolean;
    maxDistanceToBlackScene : number;
    minBlackSceneDuration : number;
}

export interface ChangeCommand {
    start: number;
    end : number;
    offset: number;
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
            new ToolOption( 'apply' ).setType( ToolValueType.Boolean ).setDefaultValue( false ),
            new ToolOption( 'verify' ).setType( ToolValueType.Boolean ).setDefaultValue( true ),
            new ToolOption( 'shiftToBlackScenes' ).setType( ToolValueType.Boolean ).setDefaultValue( true ),
            new ToolOption( 'maxDistanceToBlackScene' ).setType( ToolValueType.Number ).setDefaultValue( 30 ),
            new ToolOption( 'minBlackSceneDuration' ).setType( ToolValueType.Number ).setDefaultValue( 1 ),
        ];
    }

    async detectBlackScenes ( options : PersistSubtitlesOptions, video : string, start : number, end : number ) : Promise<Scene[]> {
        const stream = source( video, [ '-ss', '' + start, '-to', '' + end ] );

        const detector = new BlackSceneDetector( stream, { minDuration: options.minBlackSceneDuration } );

        const scenes = await detector.execute().toArray();

        return scenes.map( scene => ( { start: scene.start + start, end: scene.end + start } ) );
    }

    async shiftChange ( options : PersistSubtitlesOptions, change : ChangeCommand, video : string, lastChange : number ) {
        const metadata = await this.server.mediaTools.probe( video );

        const track = metadata.tracks.find( tr => tr.type === 'video' );

        // If there is no video track, then we won't be able to detect black scenes anyway
        if ( track == null ) {
            return;
        }

        const duration = track.duration || metadata.files[ 0 ].duration;

        const maxDistanceBehind = Math.min( change.start - lastChange, options.maxDistanceToBlackScene );

        const maxDistanceForward = Math.min( options.minBlackSceneDuration * 2, duration - change.start );

        const blackScenes = await this.detectBlackScenes( options, video, change.start - maxDistanceBehind, change.start + maxDistanceForward );

        if ( blackScenes.length > 0 ) {
            const sceneDurations = Math.max( ...blackScenes.map( scene => scene.end - scene.start ) );

            const chosenScene = blackScenes.find( scene => scene.end - scene.start === sceneDurations );

            console.log( change.start, 'to', chosenScene.start, '(', chosenScene.start - change.start, ')' );

            change.start = chosenScene.start;
        }
    }

    async run ( options : PersistSubtitlesOptions ) {
        const sameAdjustmentWindow = 60;

        console.log( options.key, options.value );

        const changes : ChangeCommand[] = [];

        let mediaIds = null;

        for await ( let command of this.server.rcHistory.readKeyed( options.key, options.value ) ) {
            mediaIds = mediaIds || command.media;

            if ( changes.length > 0 && command.playtime < changes[ changes.length - 1 ].end ) {
                continue;
            }

            if ( changes.length == 0 || command.playtime - changes[ changes.length - 1 ].end > sameAdjustmentWindow ) {
                changes.push( { start: command.playtime, end: command.playtime, offset: command.args[ 0 ] } );
            } else {
                const last = changes[ changes.length - 1 ];

                last.end = command.playtime;
                last.offset = command.args[ 0 ];
            }
        }

        if ( options.apply || options.shiftToBlackScenes ) {
            await this.server.database.install();

            const record = await this.server.media.get( mediaIds.kind, mediaIds.id );

            this.log( record.title );

            if ( isPlayableRecord( record ) ) {
                const movie = record.sources[ 0 ].id;

                const basepath = path.join( path.dirname( movie ), path.basename( movie, path.extname( movie ) ) );

                const input = basepath + '.srt';
                const output = basepath + '.corrected.srt';

                // TODO Probe the file only once
                const duration = record.runtime;

                if ( options.shiftToBlackScenes ) {
                    let lastChange = 0;
                    
                    for ( let command of changes ) {
                        await this.shiftChange( options, command, movie, lastChange );

                        lastChange = command.end;
                    }
                }

                for ( let command of changes ) {
                    console.log( Duration.parse( command.start ).toHumanShortString(), ' = ', command.offset );
                }

                if ( options.apply ) {
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

                    if ( options.verify ) {
                        const controller = new MpvSubsShiftController( this.server, offsets.map( o => o.start ) );

                        // await controller.getTimestamps( output );
                        await controller.play( movie, output );
                    }
                }
            }
        } else {
            for ( let command of changes ) {
                console.log( Duration.parse( command.start ).toHumanShortString(), ' = ', command.offset );
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

            // These offsets are savced from delay commands saved while watching the video. So when comparing the timestamps of each line,
            // we have to take into account that when the commands were applied, all the subtitles were possibly already shifted a bit
            // That's why we need to compare not just `.start < line.end`, but also apply the last offset to the line to verify
            // that it already falls into the next window
            while ( ( cursor + 1 ) < this.offsets.length && this.offsets[ cursor + 1 ].start <= ( line.end + this.offsets[ cursor ].offset ) ) {
                cursor++;
            }

            line.start += this.offsets[ cursor ].offset;
            line.end += this.offsets[ cursor ].offset;

            return MessageFactory.data( line );
        } );
    }
}

interface SubtitleTimestamp {
    start : number;
    end : number;
}

export class MpvSubsShiftController extends MpvController {
    protected shifts : number[];

    public constructor ( server : UnicastServer, shifts : number[] ) {
        super( server );

        this.shifts = shifts;
    }

    protected findMax<T> ( iterable : Iterable<T>, comparer : ( first : T, second : T ) => number ) : T {
        let biggest : T = null;

        for ( let item of iterable ) {
            if ( biggest == null ) {
                biggest = item;
            } else {
                if ( comparer( biggest, item ) < 0 ) {
                    biggest = item;
                }
            }
        }
        
        return biggest;
    }

    protected findMin<T> ( iterable : Iterable<T>, comparer : ( first : T, second : T ) => number ) : T {
        let smallest : T = null;

        for ( let item of iterable ) {
            if ( smallest == null ) {
                smallest = item;
            } else {
                if ( comparer( smallest, item ) > 0 ) {
                    smallest = item;
                }
            }
        }
        
        return smallest;
    }

    async getTimestamps ( subtitles : string ) : Promise<SubtitleTimestamp[]> {
        const lines = await this.getSubtitles( subtitles );

        let longLines = lines.filter( line => line.endTime - line.startTime >= 1500 );

        return this.shifts.map( shift => {
            const previous = this.findMax( longLines.filter( line => line.endTime < shift ), sortBy( 'startTime' ) );
            const next = this.findMin( longLines.filter( line => line.startTime > shift ), sortBy( 'startTime' ) );

            const timestamps = { start: 0, end: 0 };

            if ( previous != null && next != null ) {
                timestamps.start = previous.startTime;
                timestamps.end = next.endTime;
            } else if ( previous != null ) {
                timestamps.start = previous.startTime;
                timestamps.end = previous.endTime;
            } else if ( next != null ) {
                timestamps.start = next.startTime;
                timestamps.end = next.endTime;
            } else {
                return null;
            }

            if ( timestamps.end - timestamps.start >= 30000 ) {
                return null;
            }

            return timestamps;
        } ).filter( timestamp => timestamp != null ).map( line => ( { start: line.start - 1000, end : line.end + 1000 } ) );
    }
}