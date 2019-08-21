import { PersonRecord } from "../../../MediaRecord";
import { BaseTable } from "../../../Database/Database";
import { Request, Response } from "restify";
import { BaseTableController } from '../../BaseTableController';

export class PeopleController extends BaseTableController<PersonRecord> {
    defaultSortField : string = 'name';
    
    sortingFields : string[] = [ 'name' ]

    get table () : BaseTable<PersonRecord> {
        return this.server.database.tables.people;
    }

    async transformAll ( req : Request, res : Response, people : PersonRecord[] ) : Promise<any> {
        people = await super.transformAll( req, res, people );

        const url = this.server.getMatchingUrl( req );
        
        if ( req.query.credits === 'true' ) {
            await this.server.database.tables.people.relations.credits.applyAll( people );
        }
        
        for ( let person of people ) {
            ( person as any ).cachedArtwork = this.server.artwork.getCachedRemoteObject( url, person.art );
         
            if ( req.query.credits === 'true' ) {
                for ( let media of ( person as any ).credits ) {
                    media.cachedArtwork = this.server.artwork.getCachedObject( url, media.kind, media.id, media.art );        
                }
            }
        }

        return people;
    }
}