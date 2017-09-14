import { PlaylistRecord, BaseTable } from "../../Database";
import { BaseTableController } from "../BaseTableController";
import { Request, Response } from "restify";

export class PlaylistsController extends BaseTableController<PlaylistRecord> {
    get table () : BaseTable<PlaylistRecord> {
        return this.server.database.tables.playlists;
    }

    async transform ( req : Request, res : Response, playlist : PlaylistRecord ) : Promise<any> {
        if ( req.query.items === 'true' ) {
            ( playlist as any ).items = await Promise.all( playlist.references.map( ( { kind, id } ) => this.server.media.get( kind, id ) ) );
        }

        return playlist;
    }
}