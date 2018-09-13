import { IScraper } from "./IScraper";
import { UnicastServer } from "../UnicastServer";
import { ConfigurableEntityFactory } from "../EntityFactory";
import { ConfigInstances } from "../Config";

export abstract class ScraperFactory<P extends IScraper> extends ConfigurableEntityFactory<P> {
    readonly server : UnicastServer;

    abstract readonly type : string;

    constructor ( server : UnicastServer ) {
        super();

        this.server = server;
    }

    getDefaultsConfig () : any[] {
        return [];
    }

    getEntitiesConfig () {
        return new ConfigInstances( this.server.config ).get( 'scrapers', this.type, {
            defaults: this.getDefaultsConfig()
        } );
    }
}