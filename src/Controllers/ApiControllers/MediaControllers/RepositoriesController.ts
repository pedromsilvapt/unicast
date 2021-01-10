import { BaseController, Route } from "../../BaseController";
import { Request, Response } from "restify";
import { IMediaRepository, IVirtualRepository, VirtualRepositoryState } from '../../../MediaRepositories/MediaRepository';
import { MediaKind } from '../../../MediaRecord';

export class RepositoriesController extends BaseController {
    @Route( 'get', '' )
    async list ( req : Request, res : Response ) : Promise<IMediaRepository[] | IVirtualRepository[]> {
        const repositoriesManager = this.server.repositories;

        const kinds: MediaKind[] = req.query.kinds?.split( ',' )?.map( k => k.trim() as MediaKind );

        const repositories = Array.from( repositoriesManager )
            .filter( repo => kinds == null || kinds.some( kind => repo.hasMediaKind( kind ) ) );

        if ( req.query.virtual == 'true' ) {
            const virtualRepositories: IVirtualRepository[] = [];
            
            for ( let repository of repositories ) {
                let repoVirtualRepositories = await repository.listVirtualRepositories?.();

                if ( repoVirtualRepositories != null ) {
                    for ( let subRepo of repoVirtualRepositories ) {
                        virtualRepositories.push( subRepo ); 
                    }
                } else {
                    virtualRepositories.push( {
                        name: repository.name,
                        displayName: repository.name,
                        state: await repository.available() ? VirtualRepositoryState.Online : VirtualRepositoryState.Offline,
                    } );
                }
            }

            return virtualRepositories;
        }
            
        return repositories.map( repo => repo.toJSON() );
    }
}
