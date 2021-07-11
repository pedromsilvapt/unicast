import { BaseController, Route } from "../BaseController";
import { Response, Request } from "restify";
import * as r from 'rethinkdb';

export class UserRanksController extends BaseController {
    @Route( 'get', '/:listId/' )
    public list ( req : Request, res : Response ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        return list.semaphore.read.use( 
            () => list.getRecords() 
        );
    }

    @Route( 'del', '/:listId/' )
    public deleteList ( req : Request, res : Response ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        return list.semaphore.write.use( 
            () => list.truncate() 
        );
    }
    
    @Route( 'post', '/:listId/set-rank-before' )
    public setRankBefore ( req : Request, res : Response  ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        const { anchor, records } = req.body;

        return list.semaphore.write.use( 
            anchor != null
                ? () => list.setRankBefore( anchor, records ) 
                : () => list.setRankToBottom( records ) 
        );
    }
    
    @Route( 'post', '/:listId/set-rank-after' )
    public setRankAfter ( req : Request, res : Response  ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        const { anchor, records } = req.body;
    
        // TODO Input Validation

        return list.semaphore.write.use( 
            anchor != null
                ? () => list.setRankAfter( anchor, records )
                : () => list.setRankToTop( records )
        );
    }
}
