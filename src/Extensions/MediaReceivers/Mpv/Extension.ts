import { Extension } from "../../../ExtensionsManager";
import { MpvReceiverFactory } from './MpvReceiverFactory';

export class MpvReceiverExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.receivers.factories.add( new MpvReceiverFactory( this.server ) );
    }
}