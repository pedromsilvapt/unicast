import { Extension } from '../../../ExtensionsManager';
import { SubtitleEditSubtitlesProvider, ISubtitleEditSubtitlesConfig } from './SubtitleEditSubtitlesProvider';

export class SubtitleEditProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        // Flag controlling if this provider is enabled. If any mandatory configuration key is missing
        let enabled = true;

        const configNamespace = 'subtitles.subtitleEdit';

        const config = this.server.config.get<ISubtitleEditSubtitlesConfig>( configNamespace );

        const mandatoryConfigs : (keyof ISubtitleEditSubtitlesConfig)[] = [ 'subtitleEditFolder' ];

        if ( config == null ) {
            this.logger.warn( `Missing mandatory config key \'${configNamespace}\' for SubtitleEdit provider` );

            enabled = false;
        } else {
            if ( 'enabled' in config ) {
                enabled = config.enabled;
            }

            for ( const configName of mandatoryConfigs ) {
                if ( !( configName in config ) || config[configName] == null ) {
                    this.logger.warn( `Missing mandatory config key \'${configNamespace}.${configName}\' for SubtitleEdit provider` );
                    enabled = false;
                }
            }
        }

        if ( enabled ) {
            this.server.subtitles.providers.add( new SubtitleEditSubtitlesProvider( config ) );
        } else {
            this.logger.info( 'SubtitleEdit Provider is disabled, skipping registration.' );
        }
    }
}
