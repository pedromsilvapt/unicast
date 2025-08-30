import { Extension } from '../../../ExtensionsManager';
import { UploadedSubtitlesProvider } from './UploadedSubtitlesProvider';

export class UploadedSubtitlesProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.subtitles.providers.add( new UploadedSubtitlesProvider() );
    }
}
