import { Extension } from "../../../ExtensionsManager";
import { KodiReceiverFactory } from './KodiReceiverFactory';

export class KodiReceiverExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.receivers.factories.add( new KodiReceiverFactory( this.server ) );
    }
}