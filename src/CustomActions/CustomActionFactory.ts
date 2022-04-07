import { UnicastServer } from "../UnicastServer";
import { ConfigurableEntityFactory } from "../EntityFactory";
import { ConfigInstances } from "../Config";
import { CustomActionOptions, ICustomAction } from "./CustomAction";

export class CustomActionFactory<P extends ICustomAction> extends ConfigurableEntityFactory<P> {
    readonly server : UnicastServer;

    readonly type : string;

    readonly customActionConstructor : Class<[CustomActionOptions], P>

    constructor ( type: string, customActionConstructor: Class<[CustomActionOptions], P> ) {
        super();

        this.type = type;
        this.customActionConstructor = customActionConstructor;
    }

    getDefaultsConfig () : any[] {
        return [];
    }

    getEntitiesConfig () {
        return new ConfigInstances( this.server.config ).get( 'customActions', this.type, {
            defaults: this.getDefaultsConfig()
        } );
    }

    createFromConfig ( config: any ): Promise<P> {
        const action = new (this.customActionConstructor)( config );

        return Promise.resolve( action );
    }
}

interface Class<I extends any[], O> {
    new (...args: I): O;
}