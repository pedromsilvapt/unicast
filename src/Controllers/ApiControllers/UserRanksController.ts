import { BaseController, Route, ValidateBody } from "../BaseController";
import { Response, Request } from "restify";
import { TransactionalLog, Transaction } from 'data-transactional-log';
import { MediaKind } from '../../MediaRecord';

const MinimalMediaRecordSchema = new ObjectTypeSchema( {
    id: new StringTypeSchema(),
    kind: new UnionTypeSchema( ...[ 'movie', 'show', 'season', 'episode', 'custom' ].map( constant ) )
}, false );


export interface MediaRecordReference {
    id: string;
    kind: MediaKind;
}

export type UserRanksJournalEntry =
      { action: 'TRUNCATE', list: string }
    | { action: 'SET_RANK_AFTER', list: string, anchor: MediaRecordReference, records: MediaRecordReference[] }
    | { action: 'SET_RANK_BEFORE', list: string, anchor: MediaRecordReference, records: MediaRecordReference[] };

export class UserRanksController extends BaseController {
    protected actionsLog: TransactionalLog<UserRanksJournalEntry> = new TransactionalLog( this.server.storage.getPath( 'user-ranks-journal.json' ) );

    protected wrapActionLog<T> ( action: UserRanksJournalEntry, callback: () => Promise<T> ): () => Promise<T> {
        return async () => {
            const transaction = await this.actionsLog.transaction();
            
            try {
                await transaction.write( action );

                const result = await callback();

                await transaction.commit();

                return result;
            } catch ( err ) {
                await transaction.abort();
    
                throw err;
            }
        }
    }

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

        const action: UserRanksJournalEntry = { action: 'TRUNCATE', list: list.id };

        return list.semaphore.write.use( 
            this.wrapActionLog( action, () => list.truncate() )
        );
    }
    
    @ValidateBody( SetRankBodySchema )
    @Route( 'post', '/:listId/set-rank-before' )
    public async setRankBefore ( req : Request, res : Response  ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        const { anchor, records } = req.body;

        const action: UserRanksJournalEntry = { action: 'SET_RANK_BEFORE', list: list.id, anchor, records };

        return list.semaphore.write.use( 
            this.wrapActionLog( action, anchor != null
                ? () => list.setRankBefore( anchor, records ) 
                : () => list.setRankToBottom( records ) )
        );
    }
    
    @ValidateBody( SetRankBodySchema )
    @Route( 'post', '/:listId/set-rank-after' )
    public async setRankAfter ( req : Request, res : Response  ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );

        const { anchor, records } = req.body;

        const action: UserRanksJournalEntry = { action: 'SET_RANK_AFTER', list: list.id, anchor, records };
            
        return list.semaphore.write.use( 
            this.wrapActionLog( action, anchor != null
                ? () => list.setRankAfter( anchor, records )
                : () => list.setRankToTop( records ) )
        );
    }

    @Route( 'get', '/:listId/consistency' )
    public async consistency ( req : Request, res : Response  ) {
        const id = req.params.listId;

        const list = this.server.media.userRanks.getList( id );
            
        return list.semaphore.read.use( () => list.checkConsistency() );
    }
}
