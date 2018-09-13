import { UnicastServer } from "../UnicastServer";
import { ConfigurableEntityFactory } from "../EntityFactory";
import { ConfigInstances } from "../Config";
import { IMediaRepository } from "./MediaRepository";

export abstract class RepositoryFactory<P extends IMediaRepository> extends ConfigurableEntityFactory<P> {
    readonly server : UnicastServer;

    abstract readonly type : string;

    constructor () {
        super();
    }

    getDefaultsConfig () : any[] {
        return [];
    }

    getEntitiesConfig () {
        return new ConfigInstances( this.server.config ).get( 'repositories', this.type, {
            defaults: this.getDefaultsConfig()
        } );
    }
}