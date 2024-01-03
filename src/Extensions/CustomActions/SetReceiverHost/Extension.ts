import { CustomAction, CustomActionOptions, CustomActionResult } from '../../../CustomActions/CustomAction';
import { CustomActionContext } from '../../../CustomActions/CustomActionContext';
import { CustomActionFactory } from '../../../CustomActions/CustomActionFactory';
import { Extension } from '../../../ExtensionsManager';

export class SetReceiverHostCustomActionExtension extends Extension {
    onEntityInit () {
        super.onEntityInit();

        this.server.customActions.factories.add(
            new CustomActionFactory( 'setReceiverHost', SetReceiverHostCustomAction )
        );
    }
}

export class SetReceiverHostCustomAction extends CustomAction<SetReceiverHostOptions> {
    get label (): string {
        const address = this.options.address ?? this.server.getIpV4();
        const port = this.options.port ?? this.server.getPort();

        return `Set ${address}:${port} Host`;
    }

    getIcon () : string {
        return `<?xml version="1.0" encoding="UTF-8"?>
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" class="primaryFill">
            <path d="M4.5 5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM3 4.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
            <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H8.5v3a1.5 1.5 0 0 1 1.5 1.5h5.5a.5.5 0 0 1 0 1H10A1.5 1.5 0 0 1 8.5 14h-1A1.5 1.5 0 0 1 6 12.5H.5a.5.5 0 0 1 0-1H6A1.5 1.5 0 0 1 7.5 10V7H2a2 2 0 0 1-2-2V4zm1 0v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1zm6 7.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5z"/>
        </svg>`;
    }

    public async execute ( context : CustomActionContext ) : Promise<CustomActionResult> {
        const receiver = this.server.receivers.get( context?.device?.name );

        const address = this.options.address ?? this.server.getIpV4();
        const port = this.options.port ?? this.server.getPort();

        if ( typeof receiver["setServerAddress"] === 'function' ) {
            await receiver["setServerAddress"](address, port);
        } else {
            return CustomAction.error(`Invalid receiver "${ context?.device?.name }: does not support function 'setServerAddress'"`);
        }

        return CustomAction.success( `Host set to ${ this.server.getIpV4() }:${ this.server.getPort() }` );
    }
}

export interface SetReceiverHostOptions extends CustomActionOptions {
    address?: string;
    port?: number;
}
