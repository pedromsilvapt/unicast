import { Extension } from '../../../ExtensionsManager';
import { EmbeddedSubtitlesProvider, IEmbeddedSubtitlesConfig } from './EmbeddedSubtitlesProvider';

export class EmbeddedSubtitlesProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        // Flag controlling if this provider is enabled. If any mandatory configuration key is missing
        let enabled = true;

        const configNamespace = 'subtitles.embedded';

        const config = this.server.config.get<IEmbeddedSubtitlesConfig>( configNamespace );

        const mandatoryConfigs : (keyof IEmbeddedSubtitlesConfig)[] = [ 'subtitleEditFolder' ];

        if ( config == null ) {
            logger.warn( `Missing mandatory config key \'${configNamespace}\' for EmbeddedSubtitles provider` );

            enabled = false;
        } else {
            if ( 'enabled' in config ) {
                enabled = config.enabled;
            }

            for ( const configName of mandatoryConfigs ) {
                if ( !( configName in config ) || config[configName] == null ) {
                    logger.warn( `Missing mandatory config key \'${configNamespace}.${configName}\' for EmbeddedSubtitles provider` );
                    enabled = false;
                }
            }
        }

        if ( enabled ) {
            this.server.subtitles.providers.add( new EmbeddedSubtitlesProvider( config ) );
        } else {
            this.logger.info( 'EmbeddedSubtitles Provider is disabled, skipping registration.' );
        }
    }
}
