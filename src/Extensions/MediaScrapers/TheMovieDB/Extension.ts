import { Extension } from '../../../ExtensionsManager';
import { TheMovieDB } from './TheMovieDB';

export class TheMovieDBScraperExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.scrapers.add( new TheMovieDB( 'f090bb54758cabf231fb605d3e3e0468' ) );
    }
}