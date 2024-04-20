import { Extension } from '../../../ExtensionsManager';
import { EmbeddedSubtitlesProvider, IEmbeddedSubtitlesConfig } from './EmbeddedSubtitlesProvider';

export class EmbeddedSubtitlesProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        // Flag controlling if this provider is enabled. If any mandatory configuration key is missing
        let enabled = true;

        const configNamespace = 'subtitles.embedded';

        const config = this.server.config.get<IEmbeddedSubtitlesConfig>( configNamespace );

        if ( enabled ) {
            this.server.subtitles.providers.add( new EmbeddedSubtitlesProvider( config ) );
        } else {
            this.logger.info( 'EmbeddedSubtitles Provider is disabled, skipping registration.' );
        }
    }
}
