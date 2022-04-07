import { Extension } from '../../../ExtensionsManager';
import { DuplicatedMediaCollection } from './DuplicatedMediaCollection';

export class DuplicatedMediaCollectionExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.smartCollections.add( new DuplicatedMediaCollection() );
    }
}