import { IMediaRepository } from "./BaseRepository/IMediaRepository";
import { MediaKind } from "../MediaRecord";

export class RepositoriesManager {
    protected groupedByKind : Map<MediaKind, IMediaRepository[]> = new Map();

    protected groupedByName : Map<string, IMediaRepository[]> = new Map();

    add ( repository : IMediaRepository ) {
        if ( !this.groupedByKind.has( repository.kind ) ) {
            this.groupedByKind.set( repository.kind, [ repository ] );
        } else {
            this.groupedByKind.get( repository.kind ).push( repository );
        }

        if ( !this.groupedByName.has( repository.name ) ) {
            this.groupedByName.set( repository.name, [ repository ] );
        } else {
            this.groupedByName.get( repository.name ).push( repository );
        }
    }

    addMany ( repositories : IMediaRepository[] ) {
        for ( let repository of repositories ) {
            this.add( repository );
        }
    }

    delete ( repository : IMediaRepository ) {
        if ( this.groupedByKind.has( repository.kind ) ) {
            this.groupedByKind.set( repository.kind, this.groupedByKind.get( repository.kind ).filter( rep => rep === repository ) );
        }

        if ( this.groupedByName.has( repository.name ) ) {
            this.groupedByName.set( repository.name, this.groupedByName.get( repository.name ).filter( rep => rep === repository ) );
        }
    }

    deleteMany ( repositories : IMediaRepository[] ) {
        for ( let repository of repositories ) {
            this.delete( repository );
        }
    }

    get ( name : string, kind : MediaKind ) : IMediaRepository {
        if ( !this.groupedByName.has( name ) ) {
            return null;
        }

        return this.groupedByName.get( name ).find( rep => rep.kind === kind );
    }

    getByKind ( kind : MediaKind ) : IMediaRepository[] {
        if ( !this.groupedByKind.has( kind ) ) {
            return [];
        }

        return this.groupedByKind.get( kind );
    }

    getByName ( name : string ) : IMediaRepository[] {
        if ( !this.groupedByName.has( name ) ) {
            return [];
        }

        return this.groupedByName.get( name );
    }
}