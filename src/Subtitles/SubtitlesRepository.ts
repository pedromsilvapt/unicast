import { ILocalSubtitle } from "./SubtitlesManager";
import { UnicastServer } from "../UnicastServer";
import { MediaRecord } from "../MediaRecord";
import { ISubtitle } from "./Providers/ISubtitlesProvider";
import { SubtitlesTable } from "../Database/Database";
import * as path from 'path';
import * as fs from 'mz/fs';

export interface IDatabaseLocalSubtitle extends ILocalSubtitle {
    file : string;
    reference : { kind : string, id : string };
}

export interface ISubtitlesRepository<S extends ILocalSubtitle = ILocalSubtitle> {
    readonly canWrite : boolean;

    has ( media : MediaRecord, id : string ) : Promise<boolean>;

    get ( media : MediaRecord, id : string ) : Promise<S>;

    list ( media : MediaRecord ) : Promise<S[]>;

    read ( media : MediaRecord, subtitle : S ) : Promise<NodeJS.ReadableStream>;

    store ( media : MediaRecord, subtitle : ISubtitle, data : Buffer | NodeJS.ReadableStream ) : Promise<S>;

    update ( media : MediaRecord, subtitle : S, data : Buffer | NodeJS.ReadableStream ) : Promise<S>;

    rename ? ( media : MediaRecord, subtitle : S, name : string ) : Promise<S>;

    delete ( media : MediaRecord, subtitle : S ) : Promise<void>;
}

export class FallbackSubtitlesRepository implements ISubtitlesRepository<IDatabaseLocalSubtitle> {
    readonly canWrite : boolean = true;

    server : UnicastServer;

    get table () : SubtitlesTable {
        return this.server.database.tables.subtitles;
    }

    get folder () : string {
        return this.server.storage.getPath( 'subtitles' );
    }

    constructor ( server : UnicastServer ) {
        this.server = server;
    }

    async has ( media : MediaRecord, id : string ) : Promise<boolean> {
        return ( await this.get( media, id ) ) != null;
    }

    async get ( media : MediaRecord, id : string ) : Promise<IDatabaseLocalSubtitle> {
        const subtitles = await this.table.get( id );

        if ( !subtitles || subtitles.reference.kind != media.kind || subtitles.reference.id !== media.id ) {
            return null;
        }

        return subtitles;
    }

    async read ( media : MediaRecord, subtitle : IDatabaseLocalSubtitle ) : Promise<NodeJS.ReadableStream> {
        const folder = this.folder;

        await this.server.storage.ensureDir( folder );

        return fs.createReadStream( path.join( folder, subtitle.file ) );
    }

    async list ( media : MediaRecord ) : Promise<IDatabaseLocalSubtitle[]> {
        return this.table.find( ( query ) => query.filter( { reference: { id: media.id, kind: media.kind } } ) );
    }

    async store ( media : MediaRecord, subtitle : ISubtitle, data : Buffer | NodeJS.ReadableStream ) : Promise<IDatabaseLocalSubtitle> {
        const extension = '.' + ( subtitle.format || 'srt' ).toLowerCase();

        const folder = this.folder;

        await this.server.storage.ensureDir( folder );
        
        const prefix = path.join( folder, subtitle.releaseName );

        let file = prefix + extension;

        let index = 1;

        while ( await fs.exists( file ) ) file = prefix + '-' + index++ + extension;

        if ( Buffer.isBuffer( data ) ) {
            await fs.writeFile( file, data, { encoding: 'utf8' } );
        } else {
            await new Promise<void>( ( resolve, reject ) =>
                data.pipe( fs.createWriteStream( file ) ).on( 'error', reject ).on( 'finish', resolve )
            );
        }

        const local : IDatabaseLocalSubtitle = {
            format: path.extname( file ),
            language: null,
            releaseName: subtitle.releaseName,
            file: path.basename( file ),
            reference: { kind: media.kind, id : media.id }
        };

        return this.table.create( local );
    }

    async update ( media : MediaRecord, subtitle : IDatabaseLocalSubtitle, data : Buffer | NodeJS.ReadableStream ) : Promise<IDatabaseLocalSubtitle> {
        const file = subtitle.file;

        if ( Buffer.isBuffer( data ) ) {
            await fs.writeFile( file, data, { encoding: 'utf8' } );
        } else {
            await new Promise<void>( ( resolve, reject ) =>
                data.pipe( fs.createWriteStream( file ) ).on( 'error', reject ).on( 'finish', resolve )
            );
        }

        return subtitle;
    }

    async delete ( media : MediaRecord, subtitle : IDatabaseLocalSubtitle ) : Promise<void> {
        const match = await this.get( media, subtitle.id );

        await this.table.delete( match.id );
    }
}