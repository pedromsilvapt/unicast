import { Extension } from "../../../ExtensionsManager";
import { FileSystemRepositoryFactory } from './FileSystemRepositoryFactory';

export class FileSystemMediaRepositoryExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.repositories.factories.add( new FileSystemRepositoryFactory() );
    }
}