import { EntityManager, EntityFactoryManager } from "../EntityManager";
import { IScraper } from "./IScraper";
import { UnicastServer } from "../UnicastServer";
import { ScraperFactory } from "./ScraperFactory";

export class ScrapersManager extends EntityManager<IScraper, string> {
    protected getEntityKey( scraper : IScraper ): string {
        return scraper.name;
    }
}

export class ScraperFactoriesManager extends EntityFactoryManager<IScraper, ScrapersManager, ScraperFactory<IScraper>, string, string> {
    constructor ( receivers : ScrapersManager, server : UnicastServer ) {
        super( receivers, server );
    }

    protected getEntityKey ( entity : ScraperFactory<IScraper> ) : string {
        return entity.type;
    }
}