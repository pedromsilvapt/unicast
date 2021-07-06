import { ILocalSubtitle } from '../SubtitlesManager';
import * as child_process from 'mz/child_process';

export type ResolveSubtitleFn = (subtitle: ILocalSubtitle) => Promise<string>;

export class ExternalSynchronize {
    public readonly resolveSubtitle: ResolveSubtitleFn;
    
    public readonly config: Readonly<ExternalSynchronizeCommand>;
    
    public constructor ( config: ExternalSynchronizeCommand, resolveSubtitle: ResolveSubtitleFn ) {
        this.config = config;
        this.resolveSubtitle = resolveSubtitle;
    }

    public async buildArgs ( context: any ) : Promise<string[]> {
        const args = [];

        for ( const argConfig of this.config.args ) {
            if ( typeof argConfig === 'string' ) {
                args.push( argConfig );
            } else if ( argConfig.type === 'literal' ) {
                args.push( argConfig.value );
            } else if ( argConfig.type === 'variable' ) {
                const value = context[ argConfig.name ];

                if ( typeof argConfig.index === 'number' ) {
                    if ( argConfig.name === 'additionalSubtitles' ) {
                        const subtitle: ILocalSubtitle = value[ argConfig.index ];

                        if ( this.resolveSubtitle == null ) {
                            throw new Error(`No resolve additional subtitles function was provided.`);
                        }

                        const file = await this.resolveSubtitle( subtitle );

                        args.push( file );
                    } else {
                        args.push( value[ argConfig.index ] );
                    }
                } else {
                    args.push( value );
                }
            } else {
                throw new Error(`SyncCommand ${ this.config.name }: Invalid arg type ${ (argConfig as any).type }`);
            }
        }

        return args;
    }

    public async run ( context: any ): Promise<boolean> {
        const args = await this.buildArgs( context );

        const process = child_process.spawn( this.config.command, args, {
            cwd: this.config.cwd,
            stdio: 'inherit',
        } );

        return new Promise<boolean>( ( resolve, reject ) => {
            process.on( 'error', reject );

            process.on( 'exit', code => {
                resolve(+code === 0);
            } );
        } );
    }
}

export interface ExternalSynchronizeCommand {
    name: string;
    command: string;
    args: Array<string | {type: 'literal', value: string} | {type: 'variable', name: string, index?: number}>;
    cwd?: string;
}
