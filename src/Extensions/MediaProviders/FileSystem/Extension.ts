import { Extension } from "../../../ExtensionsManager";
import { FileSystemMediaProvider } from './FileSystemMediaProvider';

export class FileSystemMediaProviderExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.providers.add( new FileSystemMediaProvider( 'filesystem' ) );
    }
}