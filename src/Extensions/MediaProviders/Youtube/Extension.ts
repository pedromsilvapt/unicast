import { Extension } from "../../../ExtensionsManager";
import { YoutubeMediaProvider } from './YoutubeMediaProvider';

export class YoutubeMediaProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.providers.add( new YoutubeMediaProvider( 'youtube' ) );
    }
}