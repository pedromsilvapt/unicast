import {MediaKind, AllMediaKinds, isPlayableRecord} from "../MediaRecord";
import {Tool, ToolOption, ToolValueType} from "./Tool";
import {MediaSourceDetails} from "../MediaProviders/MediaSource";

export interface SetAlternativeSourcesOptions {
    kind : MediaKind;
    id : string;
    sources : string | null;
    restore : boolean;
    json : boolean;
    dryRun : boolean;
}

export class SetAlternativeSourcesTool extends Tool<SetAlternativeSourcesOptions> {
    getParameters () {
        return [
            new ToolOption( 'kind' ).setRequired( true ).setAllowedValues( AllMediaKinds ),
            new ToolOption( 'id' ).setRequired( true ),
            new ToolOption( 'sources' ).setRequired( false ).setDefaultValue( null )
        ];
    }

    getOptions(): ToolOption[] {
        return [
            new ToolOption( 'restore' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
            new ToolOption( 'json' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
            new ToolOption( 'dryRun' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
        ];
    }

    async run ( options : SetAlternativeSourcesOptions ) {
        await this.server.database.install();

        if ( options.restore && options.sources ) {
            throw new Error(`Cannot use "--restore" and specify a source as well.`);
        }

        if ( !options.restore && !options.sources ) {
            throw new Error(`Must either use "--restore" or specify a source.`);
        }

        const record = await this.server.media.get( options.kind, options.id );

        if ( !isPlayableRecord( record ) ) {
            throw new Error( 'Media kind is not playable.' );
        }

        const originalSources = await this.server.media.getOriginalSources( record );

        if ( originalSources == null ) {
            this.logSources( "ORIGINAL", record.sources );
        } else {
            this.logSources( "ORIGINAL", originalSources );
            this.logSources( "ALTERNATIVES", record.sources );
        }

        if ( options.restore ) {
            if ( originalSources == null ) {
                this.log("Already using originals, nothing to restore.");
            } else {
                this.log( "Restoring originals." );
            }

            if ( originalSources != null && !options.dryRun ) {
                await this.server.media.restoreOriginalSources( record );
            }
        } else {
            let alternativeSources: MediaSourceDetails[];

            if ( options.json ) {
                alternativeSources = JSON.parse( options.sources );
            } else {
                alternativeSources = [ { id: options.sources } ];
            }

            this.logSources( "SET ALTERNATIVES", alternativeSources );

            if ( !options.dryRun ) {
                await this.server.media.setAlternativeSources( record, alternativeSources );
            }
        }
    }

    protected logSources ( prefix : string, sources : MediaSourceDetails[] ) {
        this.log( prefix + ": " + this.stringifySources( sources ) );
    }

    protected stringifySources ( sources : MediaSourceDetails[] ) : string {
        return sources.map(s => s.id).join(", ");
    }
}