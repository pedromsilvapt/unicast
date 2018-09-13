import { FileSystemRepository } from "./FileSystemRepository";
import { RepositoryFactory } from "../RepositoryFactory";

export class FileSystemRepositoryFactory extends RepositoryFactory<FileSystemRepository> {
    type: string = 'filesystem';

    async createFromConfig ( config : any ) : Promise<FileSystemRepository> {
        return new FileSystemRepository( config.name, config );
    }
}