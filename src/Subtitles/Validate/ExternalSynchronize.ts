import { ILocalSubtitle } from '../SubtitlesManager';

export type ResolveSubtitleFn = (subtitle: ILocalSubtitle) => Promise<string>;

export class ExternalSynchronize {
    public readonly resolveSubtitle: ResolveSubtitleFn;

    public readonly config: Readonly<ExternalSynchronizeCommand>;

    public constructor ( config: ExternalSynchronizeCommand, resolveSubtitle: ResolveSubtitleFn ) {
        this.config = config;
        this.resolveSubtitle = resolveSubtitle;
    }

    public async buildUri ( context: any ) : Promise<string> {
        let uri = this.config.uri;

        for ( const key of Object.keys( context ) ) {
            if ( typeof context[ key ] == 'string' ) {
                uri = uri.replace( '{' + key + '}', context[ key ] );
            } else if ( context[ key ] instanceof Array ) {
                for ( let i = 0; i < context[ key ]; i++ ) {
                    uri = uri.replace( '{' + key + '[' + i + ']}', context[ key ][ i ] );
                }
            }
        }

        return uri;
    }

    public async run ( context: any ): Promise<string> {
        return await this.buildUri( context );
    }
}

export interface ExternalSynchronizeCommand {
    name: string;
    uri: string;
}
