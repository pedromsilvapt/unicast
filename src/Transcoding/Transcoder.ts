import { MediaStream } from "../MediaProviders/MediaStreams/MediaStream";
import { HistoryRecord } from "../Database/Database";
import { MediaRecord } from "../MediaRecord";
import { CancelToken } from 'data-cancel-token';
import { BackgroundTask } from "../BackgroundTask";
import { ReceiverTranscodingStatus } from "../Receivers/BaseReceiver/IMediaReceiver";

export enum TranscodedMediaStreamOrigin {
    Input = 'input',
    Output = 'output'
}

export interface TranscodingStreamMapping {
    input : MediaStream[];
    output : MediaStream[];
    task ?: BackgroundTask;
}

export class TranscodingSession<O = any> {
    task : BackgroundTask;

    options : Partial<O>;
    
    inputs : MediaStream[];

    protected mappings : TranscodingStreamMapping[] = [];

    protected _cachedOutputs : MediaStream[] = null;

    get outputs () : MediaStream[] {
        if ( this.isPristine ) {
            return this.inputs;
        }

        if ( !this._cachedOutputs ) {
            this._cachedOutputs = this.applyMappings( this.inputs );
        }

        return this._cachedOutputs;
    }

    get isPristine () : boolean {
        return this.mappings.length == 0;
    }

    constructor ( task : BackgroundTask, options : Partial<O>, inputs : MediaStream[] = [] ) {
        this.task = task;
        this.options = options;
        this.inputs = inputs;
    }

    addStreamsMapping ( input : MediaStream | MediaStream[], output : MediaStream | MediaStream[], task ?: BackgroundTask ) : this {
        if ( !input ) {
            input = [];
        }

        if ( !output ) {
            output = [];
        } 

        if ( !( input instanceof Array ) ) {
            input = [ input ];
        }

        if ( !( output instanceof Array ) ) {
            output = [ output ];
        }

        if ( input.length == 0 && output.length == 0 ) {
            return this;
        }

        this._cachedOutputs = null;

        this.mappings.push( { input, output, task } );

        return this;
    }

    getMappedStreamFor ( related : MediaStream ) : MediaStream {
        for ( let mapping of this.mappings ) {
            if ( mapping.output.length > 0 && mapping.input.includes( related ) ) {
                return mapping.output[ 0 ];
            }

            if ( mapping.input.length > 0 && mapping.output.includes( related ) ) {
                return mapping.input[ 0 ];
            }
        }

        return null;
    }

    getAllMappedStreamsFor ( related : MediaStream, relatedOrigin ?: TranscodedMediaStreamOrigin ) : Set<MediaStream> {
        const streams : Set<MediaStream> = new Set();

        for ( let mapping of this.mappings ) {
            if ( ( !relatedOrigin || relatedOrigin == TranscodedMediaStreamOrigin.Input ) && 
                mapping.output.length > 0 && mapping.input.includes( related ) ) {
                
                for( let stream of mapping.output ) {
                    streams.add( stream );
                }
            }

            if ( ( !relatedOrigin || relatedOrigin == TranscodedMediaStreamOrigin.Input ) && 
                mapping.input.length > 0 && mapping.output.includes( related ) ) {
                
                for( let stream of mapping.input ) {
                    streams.add( stream );
                }
            }
        }

        return streams;
    }

    getMappedOutputs () : Set<MediaStream> {
        const outputs : Set<MediaStream> = new Set();

        for ( let { output } of this.mappings ) {
            for ( let stream of output ) outputs.add( stream );
        }

        return outputs;
    }

    getMappedInputs () : Set<MediaStream> {
        const inputs : Set<MediaStream> = new Set();

        for ( let { input } of this.mappings ) {
            for ( let stream of input ) inputs.add( stream );
        }

        return inputs;
    }

    protected applyMappings ( inputs : MediaStream[] ) : MediaStream[] {
        for ( let mapping of this.mappings ) {
            if ( mapping.input.length == 0 ) {
                inputs = inputs.concat( mapping.output );
            } else if ( mapping.output.length == 0 ) {
                inputs = inputs.filter( stream => !mapping.input.includes( stream ) );
            } else {
                let firstIndex : number = -1;

                for ( let input of mapping.input ) {
                    firstIndex = inputs.indexOf( input );

                    if ( firstIndex >= 0 ) {
                        break;
                    }
                }

                // If no matching stream was found on the inputs list, just append it
                if ( firstIndex < 0 ) {
                    inputs = inputs.concat( mapping.output );
                } else {
                    inputs = [ 
                        ...inputs.slice( 0, firstIndex ), 
                        ...mapping.output, 
                        ...inputs.slice( firstIndex + 1 ).filter( stream => !mapping.input.includes( stream ) ) 
                    ];
                }
            }

            return inputs;
        }
    }

    * tasks () {
        for ( let mapping of this.mappings ) {
            if ( mapping.task ) {
                yield mapping.task;
            }
        }
    }

    toJSON () : ReceiverTranscodingStatus {
        return {
            current: 0,
            duration: 0,
            speed: 1,
            stable: true,
            task: this.task.id
        };
    }
}

export abstract class Transcoder<O> {
    abstract transcode ( session : HistoryRecord, media : MediaRecord, streams : MediaStream[], options ?: Partial<O>, cancel ?: CancelToken ) : Promise<TranscodingSession<O>>;
}

export interface TranscodedMediaStream {
    isTranscoded : true;

    task : BackgroundTask;
}

export function isTranscodedMediaStream<T> ( stream : T ) : stream is T & TranscodedMediaStream {
    return stream && ( stream as any ).isTranscoded;
}