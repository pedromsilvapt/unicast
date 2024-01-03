import { Extension } from '../../../ExtensionsManager';
import { OpenSubtitlesConfig, OpenSubtitlesProvider } from './OpenSubtitlesProvider';


export class OpenSubtitlesProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        // Flag controlling if this provider is enabled. If any mandatory configuration key is missing
        let enabled = true;

        const configNamespace = 'subtitles.openSubtitles';

        const config = this.server.config.get<OpenSubtitlesConfig>( configNamespace );

        const mandatoryConfigs : (keyof OpenSubtitlesConfig)[] = [ 'apiKey', 'password', 'username' ];

        if ( config == null ) {
            this.logger.warn( `Missing mandatory config key \'${configNamespace}\' for OpenSubtitles provider` );

            enabled = false;
        } else {
            if ( 'enabled' in config ) {
                enabled = config.enabled;
            }

            for ( const configName of mandatoryConfigs ) {
                if ( !( configName in config ) || config[configName] == null ) {
                    this.logger.warn( `Missing mandatory config key \'${configNamespace}.${configName}\' for OpenSubtitles provider` );
                    enabled = false;
                }
            }
        }

        if ( enabled ) {
            this.server.subtitles.providers.add( new OpenSubtitlesProvider( config ) );
        } else {
            this.logger.info( 'OpenSubtitles Provider is disabled, skipping registration.' );
        }
    }
}
