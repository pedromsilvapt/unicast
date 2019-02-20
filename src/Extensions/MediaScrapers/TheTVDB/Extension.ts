import { Extension } from '../../../ExtensionsManager';
import { TheTVDB } from './TheTVDB';

export class TheTVDBScraperExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.scrapers.add( new TheTVDB( 'B2038B70F41A5365' ) );
    }
}