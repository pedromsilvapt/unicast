import { Extension } from "../../../ExtensionsManager";
import { ChromecastReceiverFactory } from './ChromecastReceiverFactory';

export class ChromecastReceiverExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.receivers.factories.add( new ChromecastReceiverFactory( this.server ) );
    }
}