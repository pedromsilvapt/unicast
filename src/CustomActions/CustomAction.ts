import { LoggerInterface } from 'clui-logger';
import { UnicastServer } from '../UnicastServer';
import { CustomActionContext } from './CustomActionContext';

export interface ICustomAction<O extends CustomActionOptions = CustomActionOptions> {
    readonly name : string;

    server : UnicastServer;

    options : O;

    getButton () : CustomActionButton;

    execute ( context : CustomActionContext, options ?: any ) : Promise<CustomActionResult>;
}

export abstract class CustomAction<O extends CustomActionOptions = CustomActionOptions> implements ICustomAction<O> {
    public readonly name : string;

    public server : UnicastServer;

    public options : O;

    private _logger: LoggerInterface;

    public get logger () : LoggerInterface {
        if ( this._logger == null ) {
            this._logger = this.server.logger.service( 'CustomActions' ).service( this.name );
        }

        return this._logger;
    }

    constructor ( options : O ) {
        this.options = options;
        this.name = options.name ?? options.type;
    }

    getButton () : CustomActionButton {
        return {
            name: this.name,
            label: this.label,
            icon: this.getIcon(),
            group: this.options.group,
        };
    }

    abstract readonly label : string;

    abstract getIcon () : string;

    abstract execute ( context : CustomActionContext, options ?: any ) : Promise<CustomActionResult>;

    public static success ( message: string ): CustomActionResult {
        return { kind: 'success', message };
    }
    
    public static info ( message: string ): CustomActionResult {
        return { kind: 'info', message };
    }
    
    public static warning ( message: string ): CustomActionResult {
        return { kind: 'warning', message };
    }
    
    public static error ( message: string ): CustomActionResult {
        return { kind: 'error', message };
    }
}

export interface CustomActionOptions {
    group ?: string;
    name ?: string;
    type : string;
}

export type CustomActionResult = { kind: 'success' | 'error' | 'info' | 'warning', message: string };

export interface CustomActionButton {
    name: string;
    label: string;
    icon: string;
    group?: string;
}