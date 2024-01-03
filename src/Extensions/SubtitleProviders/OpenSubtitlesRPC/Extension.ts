import { Extension } from '../../../ExtensionsManager';
import { OpenSubtitlesRPCProvider, OpenSubtitlesRpcConfig } from './OpenSubtitlesRPCProvider';


export class OpenSubtitlesProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        // Flag controlling if this provider is enabled. If any mandatory configuration key is missing
        let enabled = true;

        const configNamespace = 'subtitles.openSubtitlesRPC';

        const config = this.server.config.get<OpenSubtitlesRpcConfig>( configNamespace );

        if ( config != null && 'enabled' in config ) {
            enabled = config.enabled;
        }

        if ( enabled ) {
            this.server.subtitles.providers.add( new OpenSubtitlesRPCProvider() );
        } else {
            this.logger.info( 'OpenSubtitlesRpc Provider is disabled, skipping registration.' );
        }
    }
}
